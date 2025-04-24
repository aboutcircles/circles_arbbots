module.exports = {
  apps: [
    {
      name: "arbbot_metestsup",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file .env.metestsup",
    },
    {
      name: "arbbot_bfn",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file .env.bfn",
    },
  ],
};
