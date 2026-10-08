# Calculadora de licencias

Aplicación web estática para calcular y administrar licencias personales. Funciona sin backend propio: la interfaz se publica en GitHub Pages y los datos privados se guardan en Firebase Cloud Firestore, con acceso limitado a un único UID de Google.

## Estructura

```text
index.html                         Pantalla única
css/app.css                        Diseño responsive
js/app.js                          Coordinación de la aplicación
js/core/                           Motor puro de fechas y saldos
js/services/                       Autenticación, Firestore y respaldos
js/ui/                             Calendario y renderizado
tests/                             Pruebas del motor
firestore.rules                    Autorización y validaciones de datos
firestore.indexes.json             Índices de Firestore
firebase.json                      Configuración de Firebase CLI
```

No hay proceso de compilación. Bootstrap, FullCalendar y el SDK web de Firebase se cargan desde CDN. Node solo se necesita para ejecutar las pruebas durante el desarrollo.

## Modelo de datos

Todos los documentos están bajo `users/{uid}` para admitir más usuarios en el futuro sin migrar datos:

| Colección | Propósito |
|---|---|
| `licenseTypes` | Nombre, unidad, color, cómputo hábil/corrido, feriados, equivalencia horaria y regla de superposición. |
| `balances` | Saldo inicial, total de ajustes y unidades consumidas por tipo. |
| `balanceAdjustments` | Ajustes inmutables con cantidad, motivo y fecha. |
| `holidays` | Feriados identificados por `AAAA-MM-DD`. |
| `licenses` | Licencias confirmadas/canceladas, fechas, consumo y copia histórica completa del cálculo y las reglas. |
| `calendarDays` | Bloqueos transaccionales por grupo y fecha para impedir superposiciones concurrentes. |
| `movements` | Libro mayor inmutable de confirmaciones, cambios, cancelaciones y ajustes. |

Los saldos se modifican en transacciones de Firestore. Confirmar o modificar una licencia actualiza su saldo, documento, movimiento y bloqueos de calendario como una sola operación. Cancelarla reintegra el saldo en otra transacción. Las reglas impiden saldos negativos y restringen formas y estados válidos. Como cualquier aplicación sin backend confiable, las reglas protegen el acceso y las invariantes expresables en Firestore; no deben reemplazarse por reglas abiertas durante el desarrollo.

## Configurar Firebase

1. Creá un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. Agregá una aplicación **Web** y copiá su objeto de configuración.
3. En **Authentication → Sign-in method**, habilitá solamente **Google**.
4. En **Authentication → Settings → Authorized domains**, agregá `<usuario>.github.io` y `localhost` para desarrollo.
5. Creá una base **Cloud Firestore**. No uses reglas de prueba.
6. Iniciá sesión una vez con tu cuenta Google y obtené el UID en **Authentication → Users**.
7. Copiá `js/config/firebase-config.example.js` como `js/config/firebase-config.js`, completá la configuración y el UID.
8. Reemplazá `REEMPLAZAR_UID` en `firestore.rules` por el mismo UID.
9. Instalá Firebase CLI, autenticá y asociá el proyecto:

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules,firestore:indexes
   ```

La configuración web de Firebase contiene identificadores públicos necesarios para conectar el navegador; no es una credencial administrativa. El archivo real se ignora en Git para evitar publicar datos de configuración por accidente. Nunca agregues archivos de cuentas de servicio, claves privadas ni credenciales administrativas.

### Configuración para GitHub Pages

GitHub Pages necesita cargar `firebase-config.js`. Hay dos opciones:

- Repositorio privado con Pages disponible: confirmá deliberadamente el archivo real en el repositorio, sabiendo que la configuración web será visible en el navegador. La seguridad depende del UID, Authentication y `firestore.rules`, no del secreto de ese objeto.
- Repositorio público: mantené el archivo ignorado y generá `firebase-config.js` en un flujo de despliegue usando GitHub Actions Secrets. Nunca pongas una cuenta de servicio en el sitio estático.

Para el caso personal más simple, también podés usar un repositorio privado y publicar desde **Settings → Pages → Deploy from a branch**, eligiendo la rama principal y la carpeta raíz `/`.

## Desarrollo local

Los módulos ES no deben abrirse con doble clic. Serví el directorio por HTTP:

```bash
npx serve .
```

Después abrí la URL local indicada. También sirve cualquier servidor estático, por ejemplo la extensión Live Server.

Ejecutá las pruebas sin instalar dependencias:

```bash
npm test
```

Las pruebas cubren extremos inclusivos, fines de semana, feriados, cambios de mes/año, equivalencias horarias, horas residuales, cálculo por cantidad, saldos negativos, fechas inválidas y superposiciones.

## Uso

- Seleccioná fechas en el calendario o completalas en el formulario.
- **Simular** calcula el consumo y saldo resultante sin escribir datos.
- **Confirmar licencia** descuenta el saldo y guarda una instantánea histórica de las reglas.
- Hacé clic sobre una licencia del calendario para modificarla o cancelarla.
- En **Configuración** podés gestionar tipos, ajustes, feriados, historial y respaldos JSON.
- Los tipos medidos en horas muestran la equivalencia configurable y preservan el remanente horario.

## Publicación

1. Verificá `npm test`.
2. Desplegá las reglas con Firebase CLI.
3. Subí los archivos a la rama configurada en GitHub Pages.
4. Confirmá que la URL final esté incluida en los dominios autorizados de Firebase Authentication.
5. Abrí el sitio en una ventana privada y comprobá que una cuenta distinta sea rechazada.

Todas las rutas del sitio son relativas y la aplicación no necesita Node.js ni un servidor de aplicación en producción.
