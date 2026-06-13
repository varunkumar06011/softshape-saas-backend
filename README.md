# Softshape.ai SaaS Backend

Standalone backend for owner registration, onboarding, payments, and tenant management.
Does NOT share code or database with softshape-backend (restaurant operations).

## Ports
- This backend: 4000
- Existing restaurant backend: 3000

## Setup
1. Create a new PostgreSQL database (separate from existing backend DB)
2. Copy .env.example to .env and fill in values
3. npm install
4. npx prisma migrate dev --name init
5. npm run dev

## Deploy to Railway
1. Push this folder as a new Railway project
2. Set all env vars in Railway dashboard
3. Railway auto-detects nixpacks.toml

## API Base URL
Set VITE_SAAS_API_URL in the frontend to point to this backend.
The existing VITE_API_URL still points to softshape-backend (unchanged).
