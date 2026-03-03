# Room - Gestor Financiero

SPA mobile-first para control financiero en pareja con panel privado y balance compartido.

## Stack
- React + Vite
- Persistencia: Google Sheets API vía función serverless de Vercel (`api/sheets.js`) con fallback local `localStorage`
- Deploy objetivo: Vercel

## Scripts
- `npm run dev`
- `npm run build`
- `npm run preview`

## Variables de entorno
Frontend (`.env`):
- `VITE_USE_REAL_SHEETS=true` para usar API real

Servidor Vercel (Project Settings > Environment Variables):
- `GOOGLE_SHEETS_ID`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY` (con saltos de línea escapados como `\n`)

Referencia: `.env.example`

## Estructura esperada de Google Sheets
- Hoja `Gastos_Compartidos` columnas A:K
   - `room`, `createdAt`, `rawInput`, `accion`, `concepto`, `montoTotal`, `divisor`, `montoPorPersona`, `pagador`, `deudaGeneradaPareja`, `destinoAparente`
- Hoja `Privado_UsuarioA` columnas A:H
   - `room`, `createdAt`, `type`, `concepto`, `montoTotal`, `rawInput`, `accion`, `pagador`
- Hoja `Privado_UsuarioB` columnas A:H
   - igual a `Privado_UsuarioA`

## Flujo MVP implementado
1. Acceso por sala + PIN + perfil.
2. Dashboard con salario privado, balance compartido, historial y consola de ingreso.
3. Intérprete de texto con Regex:
   - División por defecto en gastos compartidos: 2.
   - División explícita detectando frases como `somos 5`.
   - Detección de ambigüedad con confirmación manual.
4. Sincronización optimista: actualiza UI y persiste en segundo plano.

## Notas
- El frontend nunca expone credenciales Google; las usa solo `api/sheets.js`.
- Si `VITE_USE_REAL_SHEETS=false`, la app opera completamente en local usando `localStorage`.
