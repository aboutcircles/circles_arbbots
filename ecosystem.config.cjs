module.exports = {
  apps: [
    {
      name: "arbbot_generic",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--env-file .env.generic",
    },
  ],
};
