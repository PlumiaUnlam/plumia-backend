# PlumIA

PlumIA es una aplicación web para planificar y escribir obras. Reúne el editor del manuscrito, la organización de libros, capítulos y escenas, una Wiki del mundo narrativo, herramientas de revisión, storyboard, estadísticas, chat con IA, colaboración y exportación.

El proyecto está dividido en dos repositorios Git independientes:

- **Backend:** NestJS, Prisma y PostgreSQL. También usa Redis para trabajos en segundo plano y ofrece transcripción local de audio con Whisper.
- **Frontend:** Next.js. Durante el desarrollo se ejecuta en el puerto `3001` y se comunica con la API del backend, que usa el puerto `3000`.

## Probar la aplicación desplegada

Podés usar la versión web sin instalar Node, pnpm ni Docker:

**[Abrir PlumIA](https://plumia-frontend.vercel.app/)**

Registrate o iniciá sesión con una cuenta habilitada. La instalación local descrita abajo es una opción para desarrollo o para ejecutar una instancia propia.

## Requisitos para instalarla localmente

### Hardware

No hay un requisito de hardware publicado por el proyecto. Como referencia práctica para desarrollo local:

| Recurso | Mínimo sugerido | Recomendado |
| --- | --- | --- |
| CPU | 4 núcleos lógicos | 8 núcleos lógicos o más |
| Memoria | 8 GB | 16 GB o más |
| Espacio libre | 30 GB | 50 GB o más |
| GPU | No requerida | Opcional |

La memoria y el espacio adicionales ayudan al compilar Next.js y al construir las imágenes de Docker. La transcripción local usa Whisper en CPU por defecto; modelos más grandes tardan más y pueden consumir más memoria. Docker guarda imágenes, datos de PostgreSQL/Redis y el modelo descargado de Whisper en volúmenes locales.

### Software

- **Ubuntu o Linux**. En Windows, usar **WSL 2 con Ubuntu** y guardar los repositorios dentro del sistema de archivos de WSL (por ejemplo, `/home/usuario/proyectos`), no en `/mnt/c`.
- **Git** para clonar los repositorios.
- **Node.js 22.x**. El backend declara Node `>=22` y su imagen Docker usa Node 22.
- **pnpm 9.15.0**, que es la versión declarada por los dos proyectos. Se recomienda habilitar Corepack con la instalación de Node.
- **Docker con Docker Compose** para la base de datos, Redis, Whisper y, si querés, el backend. En Windows, habilitá la integración WSL 2 de Docker Desktop.
- Un navegador moderno, como Chrome, Edge o Firefox.

Los requisitos de CPU, memoria y disco de la tabla son recomendaciones de desarrollo, no límites medidos ni requisitos oficiales del producto. Next.js requiere Node 20.9 o posterior; este proyecto usa Node 22 por la configuración del backend. [Requisitos de Next.js](https://nextjs.org/docs/app/getting-started/installation) · [Versiones de Node.js](https://nodejs.org/en/about/previous-releases) · [Docker Desktop y WSL 2](https://docs.docker.com/desktop/features/wsl/).

Comprobá las herramientas desde la terminal de Ubuntu/WSL:

```bash
node -p "process.platform + ' ' + process.execPath"
node --version
corepack --version
pnpm --version
docker --version
docker compose version
```

El primer comando debe mostrar `linux` y una ruta Linux, por ejemplo `/usr/bin/node` o una ruta bajo `~/.nvm`. Si `pnpm` no está disponible o tiene otra versión, habilitá Corepack y activá la versión que espera el proyecto:

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm --version
```

## Clonar los repositorios

La carpeta contenedora no es un único repositorio: cada subproyecto tiene su propio historial Git. Cloná ambos en una carpeta común:

```bash
mkdir -p ~/proyectos/plumia
cd ~/proyectos/plumia
git clone https://github.com/PlumiaUnlam/plumia-backend.git
git clone https://github.com/PlumiaUnlam/plumia-frontend.git
```

La estructura resultante será:

```text
~/proyectos/plumia/
├── plumia-backend/
└── plumia-frontend/
```

Ejecutá los comandos de cada proyecto desde su propia carpeta. No ejecutes comandos Git desde la carpeta contenedora. Si te asignaron una rama de trabajo, cambiate a esa rama dentro de cada repositorio con `git switch nombre-de-rama`.

## Configuración inicial y credenciales

La aplicación integra servicios externos. Los repositorios no incluyen credenciales válidas; pedí acceso al responsable del proyecto y no subas claves, archivos de cuenta de servicio ni archivos `.env` a Git.

### 1. Configurar el backend

Desde `plumia-backend`:

```bash
cd ~/proyectos/plumia/plumia-backend
cp .env.example .env
```

Abrí `.env` y completá los valores de desarrollo que correspondan:

- **Firebase Authentication:** completá `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY`, o usá una cuenta de servicio en un archivo local `firebase-service-account.json`. El ejemplo ya apunta a ese archivo mediante `GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json`. Si usás las credenciales inline con Node, comentá esa variable en `.env` y quitá `GOOGLE_APPLICATION_CREDENTIALS` del entorno del proceso (por ejemplo, con `unset GOOGLE_APPLICATION_CREDENTIALS` en Bash). **Docker Compose requiere el archivo JSON** porque lo monta dentro del contenedor. En Firebase, habilitá el proveedor de inicio de sesión por correo y contraseña. Google es opcional si se va a usar ese método de acceso.
- **Cloudflare R2:** completá `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_IMAGES_BUCKET` y `R2_PUBLIC_URL`. El backend necesita esta configuración para iniciar porque el servicio de almacenamiento se crea al arrancar. Configurá el bucket y su URL pública según las credenciales e infraestructura de PlumIA.
- **Clave de cifrado:** `ENCRYPTION_KEY` permite guardar de forma cifrada las claves de IA que el usuario agregue desde la aplicación. Generá una y guardala como un secreto:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- **Proveedores de IA:** completá `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` y `GEMINI_API_KEY` (y `FAL_API_KEY` para imágenes). Chat, resúmenes, análisis y embeddings recorren una cadena de fallback centralizada en `src/ai/` (Anthropic, después modelos de otros proveedores vía OpenRouter y, como último recurso, la capa gratis de Gemini); los pasos sin key se saltean y cada cadena se puede cambiar con `AI_<CASO>_CHAIN` (ver `.env.example`). También se pueden configurar claves personales desde los ajustes de IA de la aplicación; para guardarlas se necesita `ENCRYPTION_KEY`.
- **Base de datos y Redis:** para la instalación local sugerida, el `.env.example` ya usa PostgreSQL en `127.0.0.1:5432` y Redis en `localhost:6379`. Si cambiás puertos o usás servicios remotos, actualizá `DATABASE_URL`, `DIRECT_URL` y `REDIS_URL`.

Si usás archivo de Firebase, colocalo en `plumia-backend/firebase-service-account.json`. El archivo está excluido de Git. En Docker Compose se monta como solo lectura dentro del contenedor.

### 2. Configurar el frontend

Desde `plumia-frontend`:

```bash
cd ~/proyectos/plumia/plumia-frontend
cp .env.example .env.local
```

Completá estas variables de la aplicación web registrada en Firebase:

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=tu-proyecto
```

Para trabajar con el backend local, usá:

```dotenv
NEXT_PUBLIC_API_URL=/api
API_URL=http://localhost:3000
```

`NEXT_PUBLIC_API_URL` se usa desde el navegador y `/api` se reenvía al backend mediante Next.js. `API_URL` es la dirección que usan Next.js y sus rutas del servidor para llamar al backend. Si cambiás puertos o direcciones, actualizá `API_URL`, `ALLOWED_ORIGINS` en el backend y la dirección pública de la API si corresponde.

`NEXT_PUBLIC_AUTH_API_URL` apunta por defecto al servicio remoto de autenticación configurado por PlumIA (`https://api-auth.plumia.com.ar`) para envío de correos de verificación y recuperación de contraseña. Si tu entorno tiene otro servicio, reemplazá la URL. Los valores con prefijo `NEXT_PUBLIC_` se incorporan al bundle del frontend al ejecutarlo o compilarlo; reiniciá el servidor después de cambiarlos.

## Opción A: ejecutar localmente con Docker Compose

Esta opción levanta API, PostgreSQL, Redis y Whisper en Docker; el frontend se ejecuta con Node en Ubuntu/WSL. Es el camino local más directo.

### 1. Preparar Docker

Instalá y ejecutá Docker. Si usás Windows, Docker Desktop debe estar iniciado y tener habilitada la integración WSL 2 para la distribución Ubuntu. Asegurate también de haber completado los archivos `plumia-backend/.env` y `plumia-backend/firebase-service-account.json` indicados arriba.

### 2. Levantar backend y servicios

Si el volumen `pgdata` ya contiene una base creada con `prisma db push` y sin historial de migraciones, preparala antes de iniciar toda la pila. Primero levantá solo PostgreSQL y esperá a que esté saludable, instalá las dependencias del backend y definí en el shell las variables que Prisma necesita (`DATABASE_URL` con el mismo valor que tiene `.env` para acceder desde tu máquina, y `SHADOW_DATABASE_URL` apuntando a una base shadow separada y descartable). Después compará la base con el estado final de `prisma/migrations`:

```bash
cd ~/proyectos/plumia/plumia-backend
docker compose up -d --wait postgres
pnpm install --frozen-lockfile
export DATABASE_URL="<el valor de DATABASE_URL de tu .env, con host 127.0.0.1>"
export SHADOW_DATABASE_URL="<una base descartable distinta de la anterior>"
pnpm exec prisma migrate diff --from-migrations ./prisma/migrations --to-url "$DATABASE_URL" --shadow-database-url "$SHADOW_DATABASE_URL"
```

Reconciliá cualquier diferencia sin borrar los datos. Cuando el esquema existente coincida con el estado final de las migraciones, registrá las migraciones ya reflejadas, en orden, con `pnpm exec prisma migrate resolve --applied <migration_name>` y verificá el resultado con `pnpm exec prisma migrate status`. No marques una migración como aplicada si sus cambios no están presentes; luego `prisma migrate deploy` podrá continuar con las pendientes.

```bash
cd ~/proyectos/plumia/plumia-backend
docker compose up -d --build --wait
```

La primera ejecución construye las imágenes y descarga PostgreSQL, Redis y Whisper. La primera transcripción puede descargar el modelo de Whisper y demorar más. El Compose espera a que PostgreSQL, Redis y Whisper estén saludables; después aplica las migraciones Prisma pendientes y arranca la API. Con `--wait` el comando termina recién cuando la API pasó su healthcheck, así que lo que sigue puede comprobarse sin esperas.

Comprobá el estado y la API:

```bash
docker compose ps
curl http://localhost:3000/health
curl http://127.0.0.1:8001/health
```

La API debería responder `{"status":"ok"}`. Whisper responde JSON e informa el modelo configurado. También podés consultar los registros:

```bash
docker compose logs -f api
docker compose logs -f postgres
```

### 3. Instalar dependencias y ejecutar el frontend

En una segunda terminal:

```bash
cd ~/proyectos/plumia/plumia-frontend
pnpm install --frozen-lockfile
pnpm dev
```

Abrí **[http://localhost:3001](http://localhost:3001)**. El script `dev` prepara los recursos de corrección ortográfica y levanta Next.js en el puerto `3001`.

### Detener los servicios

En la terminal del frontend, presioná `Ctrl+C`. Para detener y quitar los contenedores locales:

```bash
cd ~/proyectos/plumia/plumia-backend
docker compose down
```

`docker compose down` conserva los volúmenes con los datos de PostgreSQL, Redis y el modelo de Whisper. Conservar el volumen de Redis no garantiza conservar todos los trabajos: si el guardado tarda más de diez segundos, Compose puede detener Redis antes de que termine y se podrían perder trabajos recientes o exportaciones pendientes. **No uses `docker compose down -v` salvo que quieras borrar esos datos locales.**

## Opción B: ejecutar API y frontend con Node; usar Docker para infraestructura

Esta opción sirve para desarrollar el backend con recarga automática. Docker se usa solamente para PostgreSQL, Redis y Whisper.

### 1. Levantar PostgreSQL, Redis y Whisper

Configurá `plumia-backend/.env` como en la sección anterior y ejecutá:

```bash
cd ~/proyectos/plumia/plumia-backend
docker compose up -d postgres redis whisper
```

Desde Ubuntu/WSL, comprobá que PostgreSQL acepte conexiones en el puerto publicado (requiere el cliente PostgreSQL):

```bash
pg_isready -h 127.0.0.1 -p 5432 -U plumia -d plumia_development
```

Si el contenedor `api` de la opción A sigue activo, detenelo antes de levantar la API con Node para evitar que compitan por el puerto `3000`:

```bash
docker compose stop api
```

En esta modalidad el backend corre en Ubuntu/WSL, así que las direcciones del `.env` son las del host: PostgreSQL en `127.0.0.1:5432`, Redis en `localhost:6379` y Whisper en `http://127.0.0.1:8001`.

### 2. Instalar y preparar el backend

```bash
cd ~/proyectos/plumia/plumia-backend
pnpm install --frozen-lockfile
pnpm exec prisma generate
# Si la base se creó con `prisma db push` y no tiene historial de migraciones,
# hacé antes el procedimiento de baseline de la sección «Levantar backend y servicios».
pnpm exec prisma migrate deploy
pnpm start:dev
```

Si tu base ya existía y se creó con `prisma db push` (sin historial de migraciones), `migrate deploy` falla hasta que hagas el baseline descrito en la opción A: compará con `prisma migrate diff`, reconciliá las diferencias y registrá las migraciones ya reflejadas con `prisma migrate resolve --applied`. Esperá a que `pnpm exec prisma migrate deploy` finalice correctamente antes de iniciar la API. La API queda en **[http://localhost:3000](http://localhost:3000)**. `migrate deploy` aplica las migraciones pendientes sin reiniciar ni vaciar la base de datos.

### 3. Ejecutar el frontend

En otra terminal:

```bash
cd ~/proyectos/plumia/plumia-frontend
pnpm install --frozen-lockfile
pnpm dev
```

Abrí **[http://localhost:3001](http://localhost:3001)**. Para esta opción, `API_URL=http://localhost:3000` en `plumia-frontend/.env.local` permite que las rutas del servidor y las reescrituras de Next.js encuentren la API.

## Opción C: usar la versión web

No hace falta clonar repositorios ni configurar servicios locales. Abrí **[https://plumia-frontend.vercel.app/](https://plumia-frontend.vercel.app/)** y registrate o iniciá sesión. La web desplegada usa el backend y los servicios configurados para ese entorno; las variables locales no la modifican.

## Guía de uso

### Crear una cuenta y entrar

1. Abrí la aplicación local (`http://localhost:3001`) o la [versión web desplegada](https://plumia-frontend.vercel.app/).
2. Elegí **Crear cuenta** y completá los datos. La aplicación envía un correo de verificación; completá ese paso cuando lo recibas. Si iniciás sesión antes de verificarlo, la aplicación te muestra el flujo para completar la verificación. También puede aparecer la opción de acceso con Google si está habilitada para el proyecto Firebase.
3. Iniciá sesión con el correo y contraseña registrados.
4. Para recuperar la contraseña, usá la opción de recuperación en el formulario de acceso. La entrega de correos depende de `NEXT_PUBLIC_AUTH_API_URL`.

### Empezar una obra

1. Desde el panel de proyectos, creá un proyecto y completá sus datos iniciales.
2. Abrí el proyecto y organizá el manuscrito en libros, capítulos y escenas.
3. Abrí una escena para escribir. El editor guarda los cambios automáticamente; revisá el indicador de guardado antes de cerrar o cambiar de pantalla.
4. Usá el historial/versiones para revisar o restaurar versiones disponibles. Podés exportar la obra y compartirla desde las acciones del proyecto.

### Herramientas del proyecto

- **Editor:** escritura del manuscrito, formato, búsqueda y reemplazo, revisión y notas.
- **Wiki:** entidades y relaciones del mundo narrativo asociadas al proyecto.
- **Línea de tiempo y storyboard:** organizar sucesos y planificar escenas visualmente.
- **Estadísticas:** consultar métricas de escritura y objetivos del proyecto.
- **Chat y análisis con IA:** consultar el manuscrito o la Wiki y ejecutar herramientas de revisión. Su disponibilidad depende de que exista una clave de proveedor válida en los ajustes del usuario o en el backend.
- **Audio:** las notas de voz usan el servicio Whisper local en la configuración Docker. La primera transcripción puede tardar mientras se descarga el modelo.
- **Imágenes y archivos:** dependen de las credenciales y el bucket de Cloudflare R2 configurados para el backend.

### Cargar contenido de demostración para desarrollo

Después de iniciar sesión al menos una vez para que exista el usuario, podés cargar un proyecto local de prueba con manuscrito, Wiki, relaciones, estados temporales, eventos, tablero, resúmenes, análisis, chat, actividad, propuestas pendientes, versiones alternativas, anotaciones privadas, exportación y lectura compartida con comentarios:

```bash
cd ~/proyectos/plumia/plumia-backend
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm seed:demo
```

Sin filtros, el seed crea o actualiza un proyecto `PlumIA Demo Integral` para cada cuenta activa de la base local, y los proyectos quedan asociados a sus dueños. `SEED_USER_ID` o `SEED_USER_EMAIL` limitan la carga a una sola cuenta; `SEED_PROJECT_ID` selecciona un proyecto. El seed solo se ejecuta si `DATABASE_URL` y `DIRECT_URL` usan `localhost`, `127.0.0.1` o `::1`, y rechaza `NODE_ENV=production`. Esa validación comprueba únicamente el nombre del host: no garantiza que la base sea local, porque un túnel SSH o un reenvío de puertos puede hacer que `localhost` llegue a un PostgreSQL remoto. Antes de ejecutarlo verificá el destino real (por ejemplo, que no haya túneles abiertos hacia otras bases), sobre todo porque sin filtros el seed afecta a todas las cuentas activas; para acotarlo usá `SEED_USER_ID` o `SEED_USER_EMAIL`. Se puede reejecutar para restaurar los ejemplos iniciales y no elimina datos del proyecto.

Al terminar imprime el enlace del Editor y el de lectura compartida. El enlace de lectura muestra dos comentarios de ejemplo (uno abierto y otro resuelto) y permite probar respuestas y resolución. El proyecto también contiene propuestas nuevas y de actualización de entidades, propuestas de estados y relaciones, dos versiones alternativas de escena, una anotación privada y una copia de punto de control.

## Comandos útiles de desarrollo

Los comandos de Git se ejecutan en el subrepositorio correspondiente.

```bash
# Actualizar cada repositorio desde su rama actual
git -C ~/proyectos/plumia/plumia-backend pull
git -C ~/proyectos/plumia/plumia-frontend pull

# Logs y estado de los servicios Docker (backend)
cd ~/proyectos/plumia/plumia-backend
docker compose ps
docker compose logs -f api

# Validar sintaxis y configuración de Compose sin iniciar contenedores
docker compose config --quiet
```

Para desarrollo y revisión de código, los comandos definidos por los proyectos incluyen:

```bash
# Backend
cd ~/proyectos/plumia/plumia-backend
pnpm lint
pnpm typecheck
pnpm build
pnpm test

# Frontend
cd ~/proyectos/plumia/plumia-frontend
pnpm lint
pnpm exec tsc --noEmit --pretty false
pnpm build
```

## Solución de problemas

### Firebase muestra “config missing” en el frontend

Verificá que `.env.local` tenga `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` y `NEXT_PUBLIC_FIREBASE_PROJECT_ID`. Reiniciá `pnpm dev` después de editarlas.

### La API no puede iniciar por credenciales Firebase

Verificá que el archivo `plumia-backend/firebase-service-account.json` exista y corresponda al Firebase Project ID configurado. En Docker Compose el archivo se monta en `/app/firebase-service-account.json`. Si usás variables inline, asegurate de proporcionar las tres variables `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY` y de no mezclar ambas opciones.

### La API se detiene por configuración de R2

Completá las cinco variables R2 obligatorias indicadas en la configuración del backend. Aunque todavía no vayas a subir imágenes, el módulo de almacenamiento requiere estos valores al iniciar.

### La base de datos no conecta o Prisma informa que hay migraciones pendientes

En modo Docker, revisá `docker compose ps` y los logs de `postgres` y `api`. Esperá a que PostgreSQL indique `healthy`. El servicio `api` de Compose aplica las migraciones pendientes al iniciar. Si ejecutás NestJS con Node, asegurate de que PostgreSQL esté activo y ejecutá `pnpm exec prisma migrate deploy` desde `plumia-backend`.

### El frontend no encuentra la API o el navegador informa un error de CORS

Confirmá que el backend esté en el puerto `3000`, que `API_URL=http://localhost:3000` esté en `plumia-frontend/.env.local` y que `ALLOWED_ORIGINS` en `plumia-backend/.env` incluya el origen del navegador (por defecto `http://localhost:3001`). Después reiniciá ambos servidores.

### Un puerto ya está ocupado

La configuración local usa los puertos `3000` (API), `3001` (frontend), `5432` (PostgreSQL), `6379` (Redis) y `8001` (Whisper). Cerrá el otro proceso o modificá el mapeo Docker y las URL de conexión correspondientes.

### Whisper tarda o falla en la primera transcripción

La primera solicitud descarga el modelo en el volumen `whisper-models`. Revisá `docker compose logs -f whisper` y esperá a que termine la descarga. El modelo predeterminado es `base` en CPU; podés elegir otro con `WHISPER_MODEL` en el `.env` del backend.

### Una función de IA o una carga de imagen no está disponible

Las funciones de IA requieren una clave válida del proveedor seleccionado. Las cargas y lecturas de imágenes requieren los permisos, bucket y URL pública correctos de R2. Revisá las variables del backend y los logs de `api`.

### Error de módulo nativo de Node (`.node` faltante)

Instalá las dependencias desde Ubuntu/WSL con la versión de Node de Linux. No compartas `node_modules` entre Windows y WSL. Si se instalaron con otro runtime, eliminá esa carpeta de dependencias y volvé a ejecutar `pnpm install --frozen-lockfile` desde el subrepositorio afectado.

## Estructura de los repositorios

```text
plumia-backend/   API NestJS, Prisma, Docker Compose y servicios de backend
plumia-frontend/  aplicación web Next.js
```

El README del frontend incluye un acceso rápido a su instalación y enlaza a la guía central de este repositorio: [repositorio de PlumIA Backend](https://github.com/PlumiaUnlam/plumia-backend).
