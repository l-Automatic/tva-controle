module.exports = {
  apps: [
    {
      name: 'tva-api',
      cwd: './packages/api-module6',
      script: 'npm',
      args: 'run dev',
      env: {
        DATABASE_URL: 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test',
      },
    },
    {
      name: 'tva-frontend',
      cwd: './packages/frontend',
      script: 'npm',
      args: 'run dev',
    },
  ],
};
