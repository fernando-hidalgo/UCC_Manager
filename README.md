# UCC Manager

Agenda de códigos de descuento y entradas para Unión Cine Ciudad (Metromar). Requiere Google; los datos viven en Firestore y se comparten entre la extensión Firefox y la web.

## Extensión Firefox

[Firefox Add-ons](https://addons.mozilla.org/es-ES/firefox/addon/ucc-descuentos/).

1. **Entrar con Google**
2. Gestiona códigos (con validación remota contra compraentradas)
3. En `compraentradas.com/Entrada/…`, pulsa **Guardar entrada** (QR + barras → pestaña Entradas)
4. **Salir** borra la cache local (siguen en la nube)

Firestore: en la consola, permite `users/{uid}/tickets/{ticketId}` igual que `codes`.

## Web (iOS / cualquier móvil)

URL: [https://ucc-manager.web.app](https://ucc-manager.web.app)

Misma cuenta: códigos y entradas. Al **añadir un código** la web:

1. Lo valida vía Cloud Function (`validateCode` → compraentradas)
2. Guarda el código
3. Descarga la entrada asociada (`fetchEntrada` → `/Entrada/{ref}`) y la guarda aparte (borrar código ≠ borrar entrada)

Requiere plan **Blaze** (Functions con red saliente).

### Deploy (Blaze)

1. Firebase Console → proyecto en **Blaze**; Auth → Authorized domains con `ucc-manager.web.app`.
2. Google Cloud → OAuth **Web client**:
   - Orígenes JS: `https://ucc-manager.web.app` y `https://ucc-discount.firebaseapp.com`
   - URIs de redirección: **`https://ucc-manager.web.app/__/auth/handler`**
3. En el PC:

```bash
npm i -g firebase-tools
firebase login
cd c:\Users\Misco\Documents\Github\ucc-discount
firebase use ucc-discount
cd functions && npm i && cd ..
firebase deploy --only functions,hosting
```

Hosting principal: `https://ucc-manager.web.app` (el proyecto Firebase sigue llamándose `ucc-discount`).

### Alertas de cartelera (Metromar)

Lunes y jueves a las 16:00 (Europe/Madrid): si hay películas nuevas (no óperas), un correo por suscriptor. Opt-in al crear cuenta Google; opt-out en el mail o en Cartelera → Activar/Desactivar alertas.

Secrets (Gmail de la **app** como emisor + HMAC unsub):

```bash
firebase functions:secrets:set GMAIL_USER
firebase functions:secrets:set GMAIL_APP_PASSWORD
firebase functions:secrets:set UNSUB_SECRET
firebase deploy --only functions,hosting,firestore
```

`GMAIL_USER` = email emisor; `GMAIL_APP_PASSWORD` = App Password de esa cuenta; `UNSUB_SECRET` = string aleatorio (`openssl rand -base64 32`).

## Desarrollo

```bash
node selfcheck.js
```

Extensión temporal: `about:debugging` → Cargar complemento temporal → `manifest.json`.
