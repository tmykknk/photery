---
name: photery-overview
description: Overview, architecture, visual direction, and coding rules for Photery app development.
---

# Instructions
Photery is a private photo gallery app. It connects to the Google Drive API, synchronizes image metadata into Supabase, and displays the collection in a refined Next.js masonry gallery protected by a password-based routing guard.

## System Role & Tech Stack
You are an expert full-stack developer specializing in modern web applications. Strictly adhere to this stack:
- **Framework:** Next.js App Router / latest project version
- **Language:** TypeScript in strict mode
- **Database:** Supabase PostgreSQL via Supabase JS Client
- **API Integration:** Google Drive API using `googleapis` v3 and JWT service-account auth
- **Styling:** Tailwind CSS
- **Animation:** Framer Motion when fluid gallery, intro, layout, or gesture animation is needed

## Visual Direction
Photery should feel Scandinavian: calm, functional, tactile, and quietly premium.
- Use a visibly distinct font pairing: a refined display serif for the product name and gallery image titles, and a clean sans-serif for metadata and controls. Keep normal letter spacing for readable text.
- Prefer crisp off-white surfaces, pale blue-gray structure, blackened text, restrained Nordic blue accents, and sparing muted red details.
- Keep corners sharp or very modest, with structured borders and light shadows. Avoid decorative card nesting, heavy gradients, glossy effects, beige-heavy palettes, and visually loud color systems.
- The gallery is the primary experience. Do not add marketing-style hero sections, explanatory feature text, or filter UI unless explicitly requested.
- Intro animation should use a minimal modern mark, such as a geometric shutter or refined `P` symbol, and fade away quickly into the gallery.

## Workflow & Architecture Implementation

### Routing Guard (`proxy.ts`)
- Implement a route interceptor at the project root level to handle redirection logic within the Next.js routing/middleware sequence.
- Unauthenticated requests accessing protected routes must be redirected to `/login`.
- Exclude `/login`, `/api/*`, `/_next/*`, and static assets from redirection loops.

### Authentication API (`app/api/auth/route.ts`)
- Validate user-submitted passwords against the environment variable documented in `.env.local.sample`.
- Upon successful validation, issue the `site_auth` authentication cookie.

### Login Page (`app/login/page.tsx`)
- Create a clean, responsive password input form using Tailwind CSS.
- Manage password visibility properly and handle incorrect password submissions gracefully.
- Send the entered password to the authentication API, and if successful, store the verified session token (not the raw password) in a secure, HTTP-only cookie.

### Data Synchronization API (`app/api/sync/route.ts`)
- Initialize the Google Drive API client using service-account credentials.
- Query configured folders for image MIME types and exclude trashed assets.
- Store file IDs, names, and safe thumbnail metadata in Supabase.
- Do not blindly rewrite Google thumbnail URLs with suffixes like `=s1000`; this can break authorization and cause upstream 403 failures.
- For private or permission-bound Drive assets, render images through the authorized server-side image proxy instead of exposing credentials or relying on public Google URLs.

### Authorized Image Proxy (`app/api/images/[fileId]/route.ts`)
- Stream Drive images server-side with JWT auth using `drive.files.get({ fileId, alt: "media" })`.
- Validate `fileId` input before calling Google APIs.
- Never expose Google private keys, bearer tokens, service-role keys, or signed authorization details to client components.
- Return useful cache and content-type headers while preserving private access boundaries.

### Image Gallery Page (`app/page.tsx` and components)
- Fetch synchronized metadata from Supabase on the server, normalize it, and pass only safe display data to client components.
- Strip common image file extensions from visible gallery and modal titles.
- Display images in an asymmetric masonry layout (`columns-*` or equivalent), not a rigid square grid.
- Preserve natural image proportions when possible and use graceful fallback aspect ratios before images load.
- Add staggered fade-in animation as images scroll into view. Entrance fades may be calm and slower, but hover feedback must feel immediate.
- Provide subtle hover micro-interactions, such as gentle lift, mild scale, shadow emphasis, and grayscale-to-color on hover where appropriate. Do not change border color on hover; use drop shadow instead. Keep hover transitions short, around 150-200ms.
- Clicking an image must open a full-screen `backdrop-blur-md` lightbox.
- Lightbox controls should be icon-based with accessible labels, support desktop buttons, keyboard arrows, Escape close, and mobile flick/swipe gestures.
- Use Next.js `<Image />` with responsive `fill`, `sizes`, and `object-cover`/`object-contain` as appropriate.
- Because CSS multi-column masonry can visually place later DOM items above the fold, gallery card images should use `loading="eager"` unless a different masonry implementation gives deterministic above-the-fold ordering. Use `fetchPriority="high"` only for a small leading subset to avoid over-prioritizing every image.
- Provide graceful semantic UI states for empty collections and fetch failures.

## Coding Rules & Compliance

### Strict Prohibitions
- **No Arbitrary Renaming:** Do not change existing file names, function names, route names, or predefined environment variable names unless the user explicitly requests it.
- **No `.env.local` Access or Leaks:** Never read `.env.local` directly and never leak secrets into code or responses. Infer environment structure only from `.env.local.sample`.
- **No Authentication Bypassing:** Do not disable, comment out, weaken, or add backdoors to `proxy.ts`, auth handlers, or protected routes for testing convenience.
- **No Client-Side Secret Leaks:** Never expose Google credentials, Supabase service roles, JWTs, bearer tokens, or private authorization data inside `"use client"` components.
- **No `any`:** The `any` type is prohibited. Use interfaces, type guards, `unknown`, or explicit safe assertions.

### Required Practices
- **Strict Type Checking:** Keep TypeScript strict and ensure all new routes, components, and external payload handling are typed.
- **Logical Consistency & Self-Verification:** Verify state management, routing guards, async flows, null handling, and error paths before responding.
- **Self-Documenting Code:** Write clean, idiomatic code. Add concise comments only where intent is not obvious, especially around authentication, proxy streaming, or synchronization.
- **Secure Cookie Configuration:** Auth cookies (`site_auth`) must use `httpOnly: true`, `sameSite: "strict"`, and `secure: process.env.NODE_ENV === "production"`.
- **Verification:** Run `pnpm lint`, `pnpm exec tsc --noEmit`, and when route/server behavior changes, `pnpm build`.
