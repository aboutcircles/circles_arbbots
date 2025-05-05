module.exports = {
  apps: [
    {
      name: "arbbot_generic",
      script: "dist/generic/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.generic",
    },
  ],
};
