import * as url from 'url';

interface ConnectionDetails {
    host: string;
    user: string | null;
    pass: string | null;
    port: number | null;
}

function parseEndpoint(endpoint: string): ConnectionDetails {
    // Remove any quotes from the endpoint
    endpoint = endpoint.replace(/"/g, '');

    // First, check if it's a full URL (including protocol)
    if (endpoint.includes('://')) {
        try {
            const parsedUrl = new url.URL(endpoint);
            return {
                host: parsedUrl.hostname,
                user: parsedUrl.username || null,
                pass: parsedUrl.password || null,
                port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : null
            };
        } catch (error) {
            console.error('Failed to parse full URL:', error);
        }
    }

    // If not a full URL, try to split by colon to handle hostname:port format
    const parts = endpoint.split(':');
    if (parts.length === 2) {
        return {
            host: parts[0],
            user: null,
            pass: null,
            port: parseInt(parts[1], 10)
        };
    }

    // If neither of the above, return just the hostname
    return {
        host: endpoint,
        user: null,
        pass: null,
        port: null
    };
}

export function getConnectionDetails(endpoint: string, type: 'redis' | 'postgres' | 'rabbitmq'): ConnectionDetails {
    const details = parseEndpoint(endpoint);
    // Set default ports if not specified
    if (!details.port) {
        switch (type) {
            case 'redis':
                details.port = 6379;
                break;
            case 'postgres':
                details.port = 5432;
                break;
            case 'rabbitmq':
                details.port = 5671; // AMQPS port
                break;
        }
    }

    return details;
}
