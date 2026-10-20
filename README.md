# Marcadar · Radar de Marcas

**Asopiel · Piel de Ubrique**

Herramienta interna para identificar y contactar marcas de moda y complementos potencialmente interesadas en la marroquinería artesanal de Ubrique.

## Arquitectura

- **Frontend** → `frontend/index.html` desplegado en Cloudflare Pages
- **API** → `worker/index.js` desplegado como Cloudflare Worker
- **Base de datos** → Cloudflare D1 (`marcadar-db`)

## Flujo de uso

### Fase 1 — Rastreo
1. Introducir nombre o URL de una marca
2. La IA (Claude) extrae automáticamente: web, RRSS, email, precios, facturación, país de fabricación
3. Revisar el perfil y aprobar las marcas de interés

### Fase 2 — Contacto
1. Seleccionar marcas aprobadas
2. La IA genera un mail personalizado en el idioma nativo de la marca
3. Envío automático desde la app vía Resend

## Despliegue

### Worker API
```bash
cd worker
npm install -g wrangler
wrangler secret put CLAUDE_API_KEY
wrangler secret put RESEND_API_KEY
wrangler secret put ADMIN_PASSWORD
wrangler secret put FROM_EMAIL
wrangler secret put FROM_NAME
wrangler deploy
```

### Base de datos
```bash
wrangler d1 execute marcadar-db --file=../schema.sql
```

### Frontend
Desplegado en Cloudflare Pages apuntando a la carpeta `frontend/`.
