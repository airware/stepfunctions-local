const AWS = require('aws-sdk-mock');

const StateMachine = require('../state-machine');

// TODO: add tests for activity execution

describe('Test mocked lambda task', () => {
  const state = {
    Type: 'Task',
    Resource: 'arn:aws:lambda:us-east-1:000000000000:function:MyLambda',
    Next: 'NextState',
  };
  const execution = {
    executionArn: 'my-execution-arn',
    events: [],
  };
  const name = 'MyTask';
  const config = {
    lambdaEndpoint: 'http://my-endpoint:9999',
    lambdaRegion: 'my-region',
  };
  const task = StateMachine.instantiateTask(state, execution, name, config);

  afterEach(() => {
    AWS.restore('Lambda');
  });

  it('should successfully mock the execution of the lambda', async () => {
    try {
      // mock successfull execution
      AWS.mock('Lambda', 'invoke', Promise.resolve({
        StatusCode: 200,
        Payload: '{"comment":"output"}',
      }));
      const input = { comment: 'input' };
      const res = await task.execute(input);
      expect(res.output.comment).toEqual('output');
      expect(res.nextState).toEqual('NextState');
    } catch (e) {
      expect(e).not.toBeDefined();
    }
  });

  it('should mock the failure of the execution of the lambda', async () => {
    try {
      // mock failing execution
      AWS.mock('Lambda', 'invoke', Promise.resolve({
        FunctionError: 'Unhandled',
        Payload: '{"errorMessage":"error"}',
      }));
      const input = { comment: 'input' };
      const res = await task.execute(input);
      expect(res).not.toBeDefined();
    } catch (e) {
      expect(e.name).toEqual('Unhandled');
      expect(e.message).toEqual('error');
    }
  });
});

describe('Test mocked ECS task, synchronous', () => {
  const state = {
    Type: 'Task',
    Resource: 'arn:aws:states:::ecs:runTask.sync',
    Parameters: {
      Cluster: 'my-ecs-cluster',
      LaunchType: 'FARGATE',
      TaskDefinition: 'example-ecs-task:1',
    },
    Next: 'NextState',
  };
  const execution = {
    executionArn: 'my-execution-arn',
    events: [],
  };
  const name = 'MyTask';
  const config = {
    ecsEndpoint: 'http://my-endpoint:9999',
    ecsRegion: 'my-region',
  };
  const task = StateMachine.instantiateTask(state, execution, name, config);

  afterEach(() => {
    AWS.restore('ECS');
  });

  it('should successfully mock the execution of an ECS task that stops immediately', async () => {
    const runTaskResult = {
      tasks: [
        {
          taskArn: 'mock-task-arn-for-test-run',
          clusterArn: 'mock-cluster-arn-for-test',
          taskDefinitionArn: 'example-ecs-task:1',
          containerInstanceArn: 'mock-container-instance-arn-for-test',
          lastStatus: 'PENDING',
        },
      ],
    };

    const describeTasksResult = {
      tasks: [
        {
          taskArn: 'mock-task-arn-for-test-describe',
          clusterArn: 'mock-cluster-arn-for-test',
          taskDefinitionArn: 'example-ecs-task:1',
          containerInstanceArn: 'mock-container-instance-arn-for-test',
          lastStatus: 'STOPPED',
        },
      ],
    };

    // mock successfull execution
    AWS.mock('ECS', 'runTask', (params) => {
      expect(params.cluster).toEqual(state.Parameters.Cluster);
      expect(params.taskDefinition).toEqual(state.Parameters.TaskDefinition);

      return Promise.resolve(runTaskResult);
    });

    AWS.mock('ECS', 'describeTasks', (params) => {
      expect(params.cluster).toEqual(state.Parameters.Cluster);
      expect(params.tasks).toEqual([runTaskResult.tasks[0].taskArn]);

      return Promise.resolve(describeTasksResult);
    });

    const input = { comment: 'input' };
    const res = await task.execute(input);
    expect(res.output).toEqual(describeTasksResult);
    expect(res.nextState).toEqual('NextState');
  });

  it('should successfully mock the execution of an ECS task that is pending for a while and then stops', async () => {
    // This test is intentionally checking that the ECS code retries several times, and with
    // a default retry of 3 seconds between retries, we'll need a slightly longer timeout than
    // the jest default of 5 seconds.
    jest.setTimeout(15000);

    const runTaskResult = {
      tasks: [
        {
          taskArn: 'mock-task-arn-for-test-run',
          clusterArn: 'mock-cluster-arn-for-test',
          taskDefinitionArn: 'example-ecs-task:1',
          containerInstanceArn: 'mock-container-instance-arn-for-test',
          lastStatus: 'PENDING',
        },
      ],
    };

    const describeTasksResult = {
      tasks: [
        {
          taskArn: 'mock-task-arn-for-test-describe',
          clusterArn: 'mock-cluster-arn-for-test',
          taskDefinitionArn: 'example-ecs-task:1',
          containerInstanceArn: 'mock-container-instance-arn-for-test',
        },
      ],
    };

    // mock successfull execution
    AWS.mock('ECS', 'runTask', (params) => {
      expect(params.cluster).toEqual(state.Parameters.Cluster);
      expect(params.taskDefinition).toEqual(state.Parameters.TaskDefinition);

      return Promise.resolve(runTaskResult);
    });

    let describeTasksCalls = 0;

    AWS.mock('ECS', 'describeTasks', (params) => {
      expect(params.cluster).toEqual(state.Parameters.Cluster);
      expect(params.tasks).toEqual([runTaskResult.tasks[0].taskArn]);

      describeTasksCalls += 1;
      describeTasksResult.tasks[0].lastStatus = describeTasksCalls < 3 ? 'PENDING' : 'STOPPED';
      return Promise.resolve(describeTasksResult);
    });

    const input = { comment: 'input' };
    const res = await task.execute(input);
    expect(res.output).toEqual(describeTasksResult);
    expect(res.nextState).toEqual('NextState');
  });

  it('should successfully mock the execution of an ECS task that has failures launching', async () => {
    // mock successfull execution
    AWS.mock('ECS', 'runTask', Promise.resolve({
      failures: [
        {
          arn: 'mock-failure-arn-for-test',
          reason: 'mock test failure reason',
        },
      ],
    }));

    const input = { comment: 'input' };
    await expect(task.execute(input)).rejects.toThrow('There were failures running the ECS Task');
  });
});

describe('Test mocked ECS task, asynchronous', () => {
  const state = {
    Type: 'Task',
    Resource: 'arn:aws:states:::ecs:runTask',
    Parameters: {
      Cluster: 'my-ecs-cluster',
      LaunchType: 'FARGATE',
      TaskDefinition: 'example-ecs-task:1',
    },
    Next: 'NextState',
  };
  const execution = {
    executionArn: 'my-execution-arn',
    events: [],
  };
  const name = 'MyTask';
  const config = {
    ecsEndpoint: 'http://my-endpoint:9999',
    ecsRegion: 'my-region',
  };
  const task = StateMachine.instantiateTask(state, execution, name, config);

  afterEach(() => {
    AWS.restore('ECS');
  });

  it('should successfully mock the execution of an ECS task', async () => {
    const runTaskResult = {
      tasks: [
        {
          taskArn: 'mock-task-arn-for-test',
          clusterArn: 'mock-cluster-arn-for-test',
          taskDefinitionArn: 'example-ecs-task:1',
          containerInstanceArn: 'mock-container-instance-arn-for-test',
          lastStatus: 'PENDING',
        },
      ],
      failures: [],
    };

    // mock successful execution
    AWS.mock('ECS', 'runTask', (params) => {
      expect(params.cluster).toEqual(state.Parameters.Cluster);
      expect(params.taskDefinition).toEqual(state.Parameters.TaskDefinition);

      return Promise.resolve(runTaskResult);
    });

    const input = { comment: 'input' };
    const res = await task.execute(input);
    expect(res.output).toEqual(runTaskResult);
    expect(res.nextState).toEqual('NextState');
  });
});

describe('Test mocked ECS task with invalid configuration', () => {
  it('should throw on ECS Task without Parameters', async () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::ecs:runTask.sync',
      Next: 'NextState',
    };
    const execution = {
      executionArn: 'my-execution-arn',
      events: [],
    };
    const name = 'MyTask';
    const task = StateMachine.instantiateTask(state, execution, name);

    const input = { comment: 'input' };
    await expect(task.execute(input)).rejects.toThrow('Required attribute \'Parameters\' not found');
  });

  it('should throw on ECS Task without Parameters.TaskDefinition', async () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::ecs:runTask.sync',
      Parameters: {},
      Next: 'NextState',
    };
    const execution = {
      executionArn: 'my-execution-arn',
      events: [],
    };
    const name = 'MyTask';
    const task = StateMachine.instantiateTask(state, execution, name);

    const input = { comment: 'input' };
    await expect(task.execute(input)).rejects.toThrow('Required attribute \'Parameters.TaskDefinition\' not found');
  });
});

describe('Test task of unknown type', () => {
  const state = {
    Type: 'Task',
    Resource: 'unknown-type',
    Next: 'NextState',
  };
  const execution = {
    executionArn: 'my-execution-arn',
    events: [],
  };
  const name = 'MyTask';

  it('should mock the failure of the execution of the lambda', async () => {
    try {
      const task = StateMachine.instantiateTask(state, execution, name, {});
      expect(task).not.toBeDefined();
    } catch (e) {
      expect(e.name).toEqual('Error');
      expect(e.message).toEqual(`Unsupported Resource type: ${state.Resource}`);
    }
  });
});

describe('Test task.runUntilCompletionOrTimeout', () => {
  const state = {
    Type: 'Task',
    Resource: 'arn:aws:lambda:us-east-1:000000000000:function:MyLambda',
    Next: 'NextState',
    TimeoutSeconds: 1,
  };
  const execution = {
    executionArn: 'my-execution-arn',
    events: [],
  };
  const name = 'MyTask';
  const task = StateMachine.instantiateTask(state, execution, name);

  it('Should return the output if done is true immediately', async () => {
    const expected = 'return value';
    const result = { done: true, output: expected };
    const actual = await task.runUntilCompletionOrTimeout(() => result, 100);

    expect(actual).toEqual(expected);
  });

  it('Should return the output after several retries if done is false a few times and then true', async () => {
    const expected = 'return value';
    const expectedRetries = 3;

    let retries = 0;

    const actual = await task.runUntilCompletionOrTimeout(() => {
      retries += 1;
      return { done: retries >= expectedRetries, output: expected };
    }, 100);

    expect(actual).toEqual(expected);
    expect(retries).toEqual(expectedRetries);
  });

  it('Should throw an exception if the timeout is exceeded', async () => {
    await expect(task.runUntilCompletionOrTimeout(() => ({ done: false }), 100)).rejects.toThrow('Exceeded timeout');
  });
});
