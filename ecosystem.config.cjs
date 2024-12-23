module.exports = {
  apps : [
    {
      name: 'arbitrage',
      script: 'index.mjs',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      log_date_format:'YYYY-MM-DD HH:mm:ss Z',
      NODE_ENV: 'production'
    }
  ]
};
