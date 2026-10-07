module.exports = {
  apps: [
    {
      name: "aura-funding-api",
      cwd: "/root/the-aura-funding/backend",
      script: "src/server.js",
      interpreter: "node",
      autorestart: true,
      watch: false,
      restart_delay: 3000,
      max_restarts: 20,
      min_uptime: "10s",
      max_memory_restart: "300M",
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 3010
      }
    },
    {
      name: "aura-funding-ui",
      cwd: "/root/the-aura-funding/frontend",
      script: "server.js",
      interpreter: "node",
      autorestart: true,
      watch: false,
      restart_delay: 3000,
      max_restarts: 20,
      min_uptime: "10s",
      max_memory_restart: "300M",
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 3020,
        AURA_API_URL: "http://127.0.0.1:3010"
      }
    }
  ]
};
