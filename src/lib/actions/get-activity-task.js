const { isValidArn } = require('../tools/validate');
const { errors } = require('../../constants');

function getActivityTask(params, activities) {
  /* check request parameters */
  if (typeof params.activityArn !== 'string'
    || params.activityArn.length < 1
    || params.activityArn.length > 256
  ) {
    throw new Error(`${errors.common.INVALID_PARAMETER_VALUE}: --activity-arn`);
  }
  if (params.workerName && (typeof params.workerName !== 'string'
    || params.workerName.length < 1
    || params.workerName.length > 80)
  ) {
    throw new Error(`${errors.common.INVALID_PARAMETER_VALUE}: --worker-name`);
  }

  /* execute action */
  if (!isValidArn(params.activityArn, 'activity')) {
    throw new Error(errors.getActivityTask.INVALID_ARN);
  }
  const match = activities.find(activity => activity.activityArn === params.activityArn);
  if (!match) {
    throw new Error(errors.getActivityTask.ACTIVITY_DOES_NOT_EXIST);
  }

  const response = match.tasks.length ? {
    input: match.tasks[0].input,
    taskToken: match.tasks[0].taskToken,
  } : null;

  return {
    response,
  };
}

module.exports = getActivityTask;