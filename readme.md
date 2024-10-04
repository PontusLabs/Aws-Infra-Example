# Pontus Infrastructure Setup with Pulumi

This project uses Pulumi to manage the infrastructure for the Pontus application on AWS.

NOTE THAT Pulumi.dev.yaml is not used in production

## Prerequisites

- Pulumi CLI installed
- AWS CLI configured with appropriate credentials
- Node.js and npm installed

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

1. Use the `--local` flag when logging in to Pulumi:
   ```
   pulumi login --local
   ```

2. Create a new stack for development:
   ```
   pulumi stack init dev
   ```

3. When running Pulumi commands, always specify the dev stack:
   ```
   pulumi up --stack dev
   ```

This setup allows you to work on your infrastructure locally without interfering with production resources.



