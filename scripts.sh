#!/bin/bash

# Read the Pulumi config passphrase from .env
PULUMI_CONFIG_PASSPHRASE=$(grep '^PULUMI_CONFIG_PASSPHRASE=' .env | cut -d '=' -f2 | sed 's/^"//;s/"$//')

if [ -z "$PULUMI_CONFIG_PASSPHRASE" ]; then
    echo "Error: PULUMI_CONFIG_PASSPHRASE not found in .env file"
    exit 1
fi

# Export the passphrase for Pulumi to use
export PULUMI_CONFIG_PASSPHRASE

# First, read the entire file into a variable, preserving newlines
content=$(cat .env)

# Process each line
echo "$content" | while IFS= read -r line
do
    # Skip empty lines and comments
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    
    # Extract key and value
    key=$(echo "$line" | cut -d'=' -f1 | xargs)
    value=$(echo "$line" | cut -d'=' -f2- | sed 's/^"//;s/"$//' | tr -d '\r\n' | xargs)
    
    if [[ ! -z "$key" && "$key" != "PULUMI_CONFIG_PASSPHRASE" ]]; then
        pulumi config set --secret "$key" "$value"
        if [ $? -ne 0 ]; then
            echo "Failed to set Pulumi config for $key"
            exit 1
        fi
        echo "Successfully set Pulumi config for $key"
    fi
done

echo "All secrets from .env have been set in Pulumi config."
