module.exports = {
  apps: [
    {
      name: "arbbot-monitor",
      script: "./dist/monitor-server.js",
      env: {
        MONITOR_PORT: 3000,
      },
    },
  ],
};
