# Pontus Infrastructure Setup with Pulumi

This project uses Pulumi to manage the infrastructure for the Pontus application on AWS.

## Prerequisites

- Pulumi CLI installed
- AWS CLI configured with appropriate credentials
- Node.js and npm installed

## File Structure
The infrastructure is organized into the following structure:
```
├── Pulumi.dev.yaml         # Development stack configuration
├── Pulumi.yaml             # Main Pulumi project configuration
├── index.ts                # Entry point for the Pulumi program
├── infra/                  # Directory containing infrastructure modules
│   ├── databases.ts        # Database-related resources (RDS, ElastiCache, etc.)
│   ├── helper.ts           # Helper functions for infrastructure setup
│   ├── networking.ts       # Networking resources (VPC, subnets, security groups)
│   └── service.ts          # ECS service and related resources
├── package-lock.json       # Locked versions of npm dependencies
├── package.json            # Project dependencies and scripts
├── readme.md               # This file, containing project documentation
├── scripts.sh              # Shell script for setting up Pulumi config
└── tsconfig.json           # TypeScript configuration file
```

The infrastructure is modularized into separate TypeScript files within the `infra/` directory, making it easier to manage and maintain different aspects of the deployment.


## Getting Started

1. Clone this repository and navigate to the project directory.

2. Install dependencies:
   ```
   npm install
   ```

3. Log in to Pulumi:
   ```
   pulumi login
   ```
   For local development, use the `--local` flag:
   ```
   pulumi login --local
   ```
   For production, we recommend using an S3 backend for state management:
   ```
   pulumi login s3://<your-bucket-name>
   ```

4. Set up your configuration:
   - Copy the `.env.example` file to `.env`
   - Fill in the necessary values in the `.env` file

5. Set Pulumi config variables:
   Run the provided script to set your config variables from the `.env` file:
   ```
   ./scripts.sh
   ```
   This script will securely set all the variables from your `.env` file as Pulumi config secrets.

6. Deploy the infrastructure:
   For local development:
   ```
   pulumi up --stack dev
   ```
   For production:
   ```
   pulumi up --stack prod
   ```

## Infrastructure Overview

The `index.ts` file defines the following AWS resources:

- VPC with public and private subnets
- Security groups
- VPC Endpoints for AWS services
- ElastiCache Redis cluster
- RDS PostgreSQL instance
- Amazon MQ (RabbitMQ) broker
- Secrets Manager for storing application secrets
- SSL Certificate for the API domain
- ECS Cluster with Fargate service
- Application Load Balancer
- IAM roles and policies
- Route53 DNS record

## Development Setup

### Prerequisites

- Homebrew (for macOS users)
- AWS CLI
- AWS account with appropriate permissions

### Installation

1. Install Pulumi using Homebrew:
   ```
   brew install pulumi/tap/pulumi
   ```

2. Install the AWS Session Manager plugin:
   ```
   curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/{PLATFORM}/sessionmanager-bundle.zip" -o "sessionmanager-bundle.zip"
   unzip sessionmanager-bundle.zip
   sudo ./sessionmanager-bundle/install -i /usr/local/sessionmanagerplugin -b /usr/local/bin/session-manager-plugin
   ```
   Note: Replace `{PLATFORM}` with your system's platform (e.g., mac_arm64, linux_amd64, etc.)

### Configuration

1. Set up AWS credentials:
   ```
   export AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
   export AWS_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
   export AWS_REGION='YOUR_AWS_REGION'
   ```
   Note: Replace `YOUR_ACCESS_KEY_ID`, `YOUR_SECRET_ACCESS_KEY`, and `YOUR_AWS_REGION` with your actual AWS credentials and preferred region.

2. Add these environment variables to your shell configuration file (e.g., `~/.zshrc`) for persistence.

3. Login to Pulumi:
   ```
   pulumi login s3://{YOUR_PULUMI_CONFIG_BUCKET}
   ```
   Note: Replace `{YOUR_PULUMI_CONFIG_BUCKET}` with your actual Pulumi configuration bucket name.

### Project Setup

1. Copy the example environment file:
   ```
   cp .env.example .env
   ```

2. Initialize a new Pulumi stack:
   ```
   pulumi stack init
   ```

3. Change the secrets provider:
   ```
   pulumi stack change-secrets-provider "awskms://alias/{YOUR_KMS_ALIAS}?region={YOUR_AWS_REGION}"
   ```
   Note: Replace `{YOUR_KMS_ALIAS}` with your KMS alias and `{YOUR_AWS_REGION}` with your AWS region.

### Usage

1. Run the setup script:
   ```
   ./scripts.sh
   ```

2. Deploy the stack:
   ```
   pulumi up --stack {YOUR_STACK_NAME}
   ```
   Note: Replace `{YOUR_STACK_NAME}` with your actual stack name (e.g., dev, prod, etc.)

3. To interact with an ECS container:
   ```
   aws ecs execute-command --cluster {YOUR_CLUSTER_NAME} \
       --task {YOUR_TASK_ID} \
       --container {YOUR_CONTAINER_NAME} \
       --command "/bin/bash" \
       --interactive
   ```
   Note: Replace `{YOUR_CLUSTER_NAME}`, `{YOUR_TASK_ID}`, and `{YOUR_CONTAINER_NAME}` with your actual ECS cluster name, task ID, and container name respectively.

### Notes

- Always ensure your AWS credentials are up to date and have the necessary permissions.
- The `scripts.sh` file seems to be an important part of the setup process. Make sure it's present and executable.
- The ECS cluster and task IDs in the execute-command are examples. Replace them with your actual values.

Remember to never commit sensitive information like AWS credentials to version control. Always use environment variables or secure secret management solutions.