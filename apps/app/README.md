# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Local wallet backend

The wallet requires the loopback backend for passkey registration, reviewed vault provisioning, and Safe submissions. Set `VITE_SEPOLIA_RPC_URL` for direct Sepolia reads and `VITE_BACKEND_ORIGIN` for the backend origin. Default backend origin: `http://127.0.0.1:8787`.

Backend errors, unhealthy readiness, stale chain state, passkey cancellation, and onchain policy denial stay visible. The browser never receives relay keys or credential material.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
