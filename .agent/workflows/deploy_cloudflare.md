---
description: Deploy the application to Cloudflare Pages
---

# Deploy to Cloudflare Pages

This workflow will guide you through deploying your Vite application to Cloudflare Pages.

## 1. Build the Project
First, we need to build the production version of your app.

// turbo
```bash
npm run build
```

## 2. Deploy with Wrangler
We will use `wrangler` (Cloudflare's CLI) to deploy the `dist` folder.
You will be asked to log in to Cloudflare if you haven't already.

```bash
npx wrangler pages deploy dist --project-name endermax --branch master
```

## 3. Configure Custom Domain
After deployment is complete:
1.  Go to the [Cloudflare Dashboard](https://dash.cloudflare.com).
2.  Navigate to **Workers & Pages** > **endermax**.
3.  Go to **Custom Domains**.
4.  Click **Set up a custom domain**.
5.  Enter `endermax.com` and follow the instructions to verify DNS.
