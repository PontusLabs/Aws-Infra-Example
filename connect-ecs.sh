#!/bin/bash

if [ -z "$1" ]; then
    echo "Usage: ./connect-ecs.sh <stack-name>"
    exit 1
fi

STACK=$1
REGION=$(aws configure get region)

# Find the cluster name that matches the stack pattern
echo "Finding cluster for stack ${STACK}..."
CLUSTER=$(aws ecs list-clusters --region $REGION | \
    jq -r '.clusterArns[]' | \
    grep "${STACK}-app-cluster" | \
    cut -d'/' -f2)

if [ -z "$CLUSTER" ]; then
    echo "No cluster found for stack ${STACK}"
    exit 1
fi
echo "Found cluster: ${CLUSTER}"

# Get the running task ARN
echo "Finding running task..."
TASK=$(aws ecs list-tasks \
    --cluster $CLUSTER \
    --region $REGION | \
    jq -r '.taskArns[0]' | \
    cut -d'/' -f3)

if [ -z "$TASK" ] || [ "$TASK" = "null" ]; then
    echo "No running tasks found in cluster ${CLUSTER}"
    exit 1
fi
echo "Found task: ${TASK}"

# Execute the command
echo "Connecting to container..."
aws ecs execute-command \
    --region $REGION \
    --cluster $CLUSTER \
    --task $TASK \
    --container pontus-core \
    --command "/bin/bash" \
    --interactive 