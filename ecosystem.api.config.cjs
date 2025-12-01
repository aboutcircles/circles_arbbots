module.exports = {
  apps: [
    {
      name: 'price-snapshot-api',
      script: './dist/api-server.js',
      instances: 1,
      exec_mode: 'fork',
      node_args: "--env-file env_files/.env.generic",
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        API_PORT: 3000
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      log_type: 'json'
    }
  ]
};
