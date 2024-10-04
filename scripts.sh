#!/bin/bash

# Read the Pulumi config passphrase from .env
PULUMI_CONFIG_PASSPHRASE=$(grep '^PULUMI_CONFIG_PASSPHRASE=' .env | cut -d '=' -f2)

if [ -z "$PULUMI_CONFIG_PASSPHRASE" ]; then
    echo "Error: PULUMI_CONFIG_PASSPHRASE not found in .env file"
    exit 1
fi

# Export the passphrase for Pulumi to use
export PULUMI_CONFIG_PASSPHRASE

# Read .env file and set Pulumi config secrets
while IFS='=' read -r key value
do
    # Remove any leading/trailing whitespace from key and value
    key=$(echo $key | xargs)
    value=$(echo $value | xargs)
    
    # Skip empty lines, comments, and the PULUMI_CONFIG_PASSPHRASE
    if [[ ! -z "$key" && ! "$key" =~ ^# && "$key" != "PULUMI_CONFIG_PASSPHRASE" ]]; then
        # Set the Pulumi config secret
        pulumi config set --secret "$key" "$value"
        echo "Set secret for $key"
    fi
done < .env

echo "All secrets from .env have been set in Pulumi config."
