module.exports = {
  apps: [
    {
      // Generic Instance
      name: "arbbot_generic",
      script: "src/generic/index.ts",
      interpreter: "tsx",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.generic",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/generic-error.log",
      out_file: "logs/generic-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
