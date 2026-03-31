# Tailwind CSS v4 Reference

Tailwind CSS v4 is the latest major version. Key differences from v3:

## Setup with Vite

Install:

```sh
npm install tailwindcss @tailwindcss/vite
```

Add the Vite plugin in `vite.config.ts`:

```ts
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
});
```

In your CSS file, just add:

```css
@import "tailwindcss";
```

## Key Changes from v3

1. **No `tailwind.config.js`** — Configuration is now done in CSS using `@theme` directive
2. **CSS-first configuration** — Use `@theme` to customize design tokens:
   ```css
   @import "tailwindcss";
   @theme {
     --color-primary: #3490dc;
     --font-display: "Satoshi", sans-serif;
   }
   ```
3. **No `@tailwind` directives** — Just `@import "tailwindcss"` replaces `@tailwind base/components/utilities`
4. **Plugins use `@plugin`** — e.g. `@plugin "daisyui";`
5. **Custom variants use `@variant`**
6. **`@apply` still works** but using utility classes directly is preferred
7. **Dark mode** — Use `dark:` variant as before, works with `prefers-color-scheme` by default
8. **Container queries** — Built-in support with `@container` variants
9. **`!important` modifier** — Use `!` suffix: `bg-red-500!` (was `!bg-red-500` in v3)

## Common Patterns

### Responsive Design

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"></div>
```

### Dark Mode

```html
<div class="bg-white dark:bg-gray-900"></div>
```

### Hover/Focus States

```html
<button class="bg-blue-500 hover:bg-blue-700 focus:ring-2"></button>
```

## Documentation

- Official docs: https://tailwindcss.com/docs
- v4 upgrade guide: https://tailwindcss.com/docs/upgrade-guide
