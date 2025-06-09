module.exports = {
  apps: [
    {
      // Astronauts Group Instance
      name: "arbbot_astronauts",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.astronauts",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/astronauts-error.log",
      out_file: "logs/astronauts-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
      },
    },
    {
      // MC Satellite Group Instance
      name: "arbbot_satellite",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.satellite",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/satellite-error.log",
      out_file: "logs/staellite-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
      },
    },
    {
      // Dappcon25 Group Instance
      name: "arbbot_dappcon",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.dappcon",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/dappcon-error.log",
      out_file: "logs/dappcon-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
      },
    },
    {
      // KPK Group Instance
      name: "arbbot_kpk",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.kpk",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/kpk-error.log",
      out_file: "logs/kpk-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
      },
    },
    {
      // Lisboa Group Instance
      name: "arbbot_lisboa",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.lisboa",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/lisboa-error.log",
      out_file: "logs/lisboa-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
      },
    },
    {
      // Blockscout Group Instance
      name: "arbbot_blockscout",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.blockscout",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/blockscout-error.log",
      out_file: "logs/blockscout-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
      },
    },
    {
      // Breadchain Group Instance
      name: "arbbot_breadchain",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.breadchain",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/breadchain-error.log",
      out_file: "logs/breadchain-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
      },
    },
    {
      // Zubln Group Instance
      name: "arbbot_zubln",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.zubln",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/zubln-error.log",
      out_file: "logs/zubln-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
      },
    },
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
      // Backers Group Instance
      name: "arbbot_zucrc",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.zucrc",

      // Restart settings
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 1000,
      exp_backoff_restart_delay: 50,

      // Resource management
      max_memory_restart: "2G",
      kill_timeout: 5000,

      // Logging
      error_file: "logs/zucrc-error.log",
      out_file: "logs/zucrc-out.log",
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
