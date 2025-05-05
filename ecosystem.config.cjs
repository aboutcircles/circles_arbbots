module.exports = {
  apps: [
    {
      name: "arbbot_metestsup",
      script: "dist/group-specific/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.metestsup",
    },
    {
      name: "arbbot_bfn",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.bfn",
    },
    {
      name: "arbbot_generic",
      script: "dist/generic/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file env_files/.env.generic",
    },
  ],
};
