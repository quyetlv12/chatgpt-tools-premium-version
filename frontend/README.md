# Shoptaikhoan native React frontend

React JavaScript + Vite, shadcn/Radix, Tailwind, TanStack Query and Lucide.
All workspace pages render React components. There is no legacy HTML iframe.

See `../migration/README.md` for isolation, backend startup, commands and limits;
`DESIGN.md` records the visual direction. The frontend requires the independent
Suite backend on localhost:5150. The dev server uses localhost:5151 with a strict
port so it never takes another project’s port. Use `bun run dev`, `bun run test`, `bun run lint`
and `bun run build`. Build the independent macOS app with
`./build-react-test-macos.sh` from the repository root.
