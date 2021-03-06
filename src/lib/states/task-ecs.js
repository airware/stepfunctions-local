const AWS = require('aws-sdk');
const Task = require('./task');
const { pascalCaseToCamelCase } = require('../tools/case');
const addHistoryEvent = require('../actions/custom/add-history-event');

class TaskEcs extends Task {
  async invokeEcsTask() {
    const ecsConfig = {};
    if (this.config && this.config.ecsEndpoint) {
      ecsConfig.endpoint = this.config.ecsEndpoint;
    }
    if (this.config && this.config.ecsRegion) {
      ecsConfig.region = this.config.ecsRegion;
    }
    const ecs = new AWS.ECS(ecsConfig);

    this.validateParams();
    const parameters = this.state.Parameters;

    // Pass in only the supported parameters from this page:
    // https://docs.aws.amazon.com/step-functions/latest/dg/connectors-ecs.html
    // Note that we need to call pascalCaseToCamelCase on any objects below as Step
    // Functions requires all object keys to be PascalCase, whereas the ECS API requires
    // them all to be camelCase.
    const params = {
      cluster: parameters.Cluster,
      group: parameters.Group,
      launchType: parameters.LaunchType,
      networkConfiguration: pascalCaseToCamelCase(parameters.NetworkConfiguration),
      overrides: pascalCaseToCamelCase(parameters.Overrides),
      placementConstraints: pascalCaseToCamelCase(parameters.PlacementConstraints),
      placementStrategy: pascalCaseToCamelCase(parameters.PlacementStrategy),
      platformVersion: parameters.PlatformVersion,
      taskDefinition: parameters.TaskDefinition,
    };

    const runTaskResult = await ecs.runTask(params).promise();

    if (runTaskResult.failures && runTaskResult.failures.length > 0) {
      throw new Error(`There were failures running the ECS Task for state ${this.name}: ${JSON.stringify(runTaskResult.failures)}`);
    }

    addHistoryEvent(this.execution, 'TASK_SCHEDULED');

    if (this.useSync) {
      const task = TaskEcs.getTaskFromEcsTaskResult(runTaskResult);
      return this.waitForEcsTaskToFinish(ecs, parameters, task.taskArn);
    }

    return runTaskResult;
  }

  waitForEcsTaskToFinish(ecs, parameters, taskArn) {
    // TODO: I've seen a history event called TaskSubmitted...
    // What does that mean and how is it different than TaskScheduled?

    const params = {
      cluster: parameters.Cluster,
      tasks: [taskArn],
    };

    let historyEventRunningFired = false;

    return this.runUntilCompletionOrTimeout(async () => {
      const describeTaskResult = await ecs.describeTasks(params).promise();
      const task = TaskEcs.getTaskFromEcsTaskResult(describeTaskResult);

      switch (task.lastStatus) {
        case 'RUNNING':
          if (!historyEventRunningFired) {
            historyEventRunningFired = true;
            addHistoryEvent(this.execution, 'TASK_STARTED');
          }
          return { done: false, output: describeTaskResult };
        case 'STOPPED':
          return { done: true, output: describeTaskResult };
        default:
          return { done: false, output: describeTaskResult };
      }
    });
  }

  async invoke() {
    try {
      const output = await this.invokeEcsTask();
      addHistoryEvent(this.execution, 'TASK_SUCCEEDED');
      return { output };
    } catch (e) {
      addHistoryEvent(this.execution, 'TASK_FAILED', {
        cause: e.name,
        error: e.message,
      });
      const handledError = this.handleError(e);
      return { output: handledError.output, next: handledError.nextState };
    }
  }

  validateParams() {
    if (!this.state.Parameters) {
      throw new Error(`Required attribute 'Parameters' not found for ECS state ${this.name}.`);
    }

    if (!this.state.Parameters.TaskDefinition) {
      throw new Error(`Required attribute 'Parameters.TaskDefinition' not found for ECS state ${this.name}.`);
    }
  }

  /**
   * Extract a single ECS task from the result to a RunTask or DescribeTasks AWS API call.
   *
   * @param ecsTaskResult
   */
  static getTaskFromEcsTaskResult(ecsTaskResult) {
    if (!ecsTaskResult.tasks || ecsTaskResult.tasks.length > 1) {
      throw new Error(`Expected to find one ECS Task in the results, but got: ${JSON.stringify(ecsTaskResult.tasks)}`);
    }

    return ecsTaskResult.tasks[0];
  }
}

module.exports = TaskEcs;
