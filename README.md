# THE AURA FUNDING

A production-oriented funded trading platform built from scratch.

## Architecture
- Node.js backend
- PostgreSQL as the trading/account source of truth
- Central admin-controlled Risk Engine
- REST API + WebSocket foundation
- User flow: Login → Trading Environment → Plan → Checkout → Dashboard → Position
- Trading Terminal is a separate phase and will use the same backend/Risk Engine.

## Safety principle
Trading, account state, P&L and risk decisions are server-side. The frontend is never the source of truth.

## Development rule
Do not modify the existing Course-Era/Aura project. This repository is independent.
