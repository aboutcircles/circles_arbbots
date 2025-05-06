module.exports = {
  apps: [
    {
      // METRI Test Supergroup Instance
      name: "arbbot_metestsup",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.metestsup",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/metestsup-error.log",
      out_file: "logs/metestsup-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Environment
      env: {
        NODE_ENV: "production",
      },
    },

    {
      // BFN Instance
      name: "arbbot_bfn",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.bfn",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/bfn-error.log",
      out_file: "logs/bfn-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
      },
    },

    {
      // Backers Group Instance
      name: "arbbot_backers",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.backers",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/backers-error.log",
      out_file: "logs/backers-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Environment
      env: {
        NODE_ENV: "production",
      },
    },

    {
      // Generic Instance
      name: "arbbot_generic",
      script: "dist/generic/index.js",
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
