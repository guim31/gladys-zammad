# Zammad

Su helpdesk [Zammad](https://zammad.org) en Gladys: el número de tickets
abiertos, nuevos, pendientes y escalados, los que están sin asignar, los
asignados a usted y los creados hoy, para toda la instancia y para los grupos
que elija. Una escena reacciona a un nuevo ticket o a un ticket que superó su
plazo de escalada SLA, otra abre un ticket desde un sensor o un botón, y el
panel lista los últimos tickets abiertos.

> **Sus comentarios son bienvenidos.** Esta integración se probó contra un
> servidor Zammad real (imagen Docker `ghcr.io/zammad/zammad` 7.2.2, octubre
> de 2026), aún no en el uso diario. Si algo no funciona como se describe,
> dígalo en el [foro de Gladys](https://community.gladysassistant.com) o en
> las [issues](https://github.com/guim31/gladys-zammad/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Un **Zammad** accesible desde Gladys: autoalojado o alojado por Zammad
  (`*.zammad.com`). Probado con Zammad 7.2; Elasticsearch no es necesario.
- Un **token de acceso personal** de un agente de Zammad. En Zammad: su
  avatar → **Perfil** → **Acceso por token** → **Crear**, con el permiso
  **Tickets de agente** (`ticket.agent`). Cópielo: Zammad solo lo muestra una
  vez. Si falta el menú, un administrador activa **Acceso por token de API**
  en **Sistema** → **API**.

La integración ve los tickets de los grupos a los que este agente tiene
acceso, y crea tickets **como este agente**. Un agente dedicado, miembro de
los grupos que se siguen, lo mantiene todo claro.

## Configuración

1. En Gladys, **Integraciones** → instale **Zammad**.
2. En su pantalla **Configuración**:
   - **Dirección**: la dirección de Zammad, como en el navegador, p. ej.
     `https://helpdesk.example.org` (con `:puerto` si hace falta);
   - **Token de acceso**: el token creado arriba;
   - **Grupos seguidos** (opcional): nombres de grupos separados por comas,
     p. ej. `Users, Hardware`. Cada uno tiene su propio dispositivo con sus
     contadores. Vacío: solo el dispositivo de la instancia;
   - **Aceptar certificados autofirmados**: solo para su propio servidor con
     un certificado autofirmado;
   - **Intervalo de actualización**: 1, 2 (predeterminado), 5 o 10 minutos;
   - **Idioma de los nombres de funciones**: los nombres dados a las funciones
     al añadir un dispositivo (francés por defecto).
3. Haga clic en **Probar la conexión**: indica cuántos tickets están abiertos
   y escalados, y los grupos seguidos que no existen.
4. En **Descubrimiento**, añada los dispositivos que desee.

Cada lectura cuesta seis pequeñas solicitudes (el usuario, los estados, los
grupos, los tickets abiertos, los escalados y los creados hoy), y una más por
cada 100 tickets más allá de los 100 primeros de una búsqueda, 1000 tickets
como máximo por
búsqueda.

## Dispositivos

- **Zammad**: toda la instancia (los grupos del agente).
- **Zammad <grupo>**: uno por grupo seguido.

Funciones (contadores, con historial):

| Función                | Significado                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| Tickets abiertos       | estado nuevo, abierto, recordatorio pendiente o cierre pendiente  |
| Tickets nuevos         | estado nuevo                                                      |
| Tickets pendientes     | estado recordatorio pendiente o cierre pendiente                  |
| Tickets escalados      | abiertos, pasada la hora de escalada de su SLA                    |
| Tickets sin asignar    | abiertos, sin propietario                                         |
| Tickets asignados a mí | abiertos, del agente del token (solo instancia)                   |
| Tickets creados hoy    | creados desde medianoche (hora de Gladys), sea cual sea su estado |

Las horas de escalada vienen de los **SLA** de Zammad: sin SLA, ningún ticket
se escala. Los contadores cambian en cada lectura, a medianoche y a la
siguiente hora de escalada.

## Panel

El widget **Tickets abiertos** muestra los 10 últimos tickets abiertos, con
su número, título, estado y grupo; los escalados en rojo, los nuevos en
naranja. Encima, dos mosaicos: tickets abiertos y escalados.

Ajustes: **Dispositivo** (vacío: toda la instancia; un dispositivo de grupo:
solo ese grupo) y **Mostrar los contadores** (desmárquelo para dejar solo la
lista).

## Escenas

### Disparadores

- **Nuevo ticket de Zammad**: se creó un ticket en un grupo del agente, visto
  en la siguiente lectura (aunque se haya cerrado entretanto).
- **Ticket de Zammad escalado**: un ticket abierto superó su plazo de escalada
  SLA (primera respuesta, actualización o solución). Se dispara una vez por
  hora de escalada: si una respuesta fija una nueva hora y esta también pasa,
  se vuelve a disparar.

Ambos se filtran por **Grupo** (exactamente como en Zammad) y **Prioridad**
(las prioridades predeterminadas `1 low`, `2 normal`, `3 high`). Transmiten a
la escena el título, el número del ticket, el identificador del ticket, el
grupo, la prioridad, el estado, el cliente y la dirección del ticket; también
la hora de escalada para el segundo.

### Acciones

- **Crear un ticket de Zammad**: abre un ticket con un **Título**, en un
  **Grupo** (nombre o número; vacío: el primer grupo seguido, si no el primer
  grupo del agente), con un **Texto** (vacío: el título), una **Prioridad**
  (vacío: la predeterminada de Zammad) y un **Correo del cliente** (vacío: el
  agente del token; una dirección desconocida crea el cliente). Los pasos
  siguientes reciben el identificador del ticket, su número, su título, su
  grupo y su dirección.

### Ideas de escenas

- Un detector de fugas en la sala de servidores: **Crear un ticket de
  Zammad** «Agua detectada» en el grupo `Hardware`, prioridad `3 high`.
- **Ticket de Zammad escalado** en el grupo `Support`: hacer parpadear la luz
  de la oficina y enviar un mensaje con el título y la dirección del ticket.
- **Nuevo ticket de Zammad** de prioridad `3 high` fuera del horario de
  oficina: avisar a la persona de guardia.

## Solución de problemas

- **«token de acceso rechazado»**: el token es erróneo, caducó o se
  eliminó: cree uno nuevo.
- **«el token no tiene el permiso tickets de agente»**: cree el token de nuevo
  con el permiso **Tickets de agente**.
- **«esta dirección no responde como Zammad»**: compruebe la dirección; detrás
  de un proxy inverso bajo una ruta, indique también esa ruta
  (`https://example.org/zammad`).
- **«redirigido»**: indique directamente la dirección `https://`.
- **«certificado rechazado»**: marque **Aceptar certificados autofirmados**
  (solo para su propio servidor).
- **Nunca un ticket escalado**: Zammad solo fija horas de escalada mediante un
  **SLA** (**Gestionar** → **SLA**) con un calendario.
- Un grupo de **Grupos seguidos** que no existe se ignora: **Probar la
  conexión** lo nombra.

## Límites

- Lectura cada 1 a 10 minutos: un nuevo ticket dispara su escena en la
  siguiente lectura, no al instante (no se usan los webhooks de Zammad).
- 1000 tickets como máximo por búsqueda: por encima, los tickets abiertos más
  antiguos no se cuentan. Los escalados se leen aparte y siempre se cuentan.
- El filtro de prioridad ofrece las prioridades predeterminadas de Zammad; una
  prioridad renombrada no se puede elegir ahí.
- Un ticket creado mientras la integración o Zammad estuvieron detenidos más
  de una hora no dispara su escena.
- Sin relación con Zammad GmbH ni con la Zammad Foundation.
