module.exports = {
    apps: [
      {
        name: "arbbot_cms",
        script: "dist/index.js", 
        instances: 1, 
        exec_mode: "fork", 
        node_args: "--env-file .env.cmg"
      },
      {
        name: "arbbot_homegroup",
        script: "dist/index.js",
        instances: 1,
        exec_mode: "fork",
        node_args: "--env-file .env.homegroup"
      },
    ]
  };