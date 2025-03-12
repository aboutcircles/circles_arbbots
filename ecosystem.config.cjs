module.exports = {
    apps: [
      {
        name: "arbbot_cmg",
        script: "dist/index.js",
        instances: 1,
        exec_mode: "fork",
        node_args: "--env-file .env.cmg"
      },
      // {
      //   name: "arbbot_metestsup",
      //   script: "dist/index.js",
      //   instances: 1,
      //   exec_mode: "fork",
      //   node_args: "--env-file .env.metestsup"
      // },
    ]
  };
