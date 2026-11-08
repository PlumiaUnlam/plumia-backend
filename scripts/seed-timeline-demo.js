require('dotenv/config');

const { createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_TITLE = 'PlumIA Demo Integral';
/** Derives a repeatable reader token scoped to a demo project. */
const demoReaderToken = (projectId) =>
  `plumia-local-demo-reader-${sha256(projectId).slice(0, 24)}`;
const books = [
  [
    '001',
    'La Semilla de Luz',
    [
      [
        '001',
        'El llamado',
        [
          [
            'ventana',
            '001',
            'Una luz en la ventana',
            'DONE',
            [
              'A las tres y catorce de la madrugada, Eliana abrió los ojos antes de que sonara el reloj del pasillo. Una luz azul pulsaba detrás de los postigos y dibujaba sobre el techo la silueta imposible de la antigua atalaya.',
              'La torre llevaba cerrada desde antes de que naciera su abuelo. Sin embargo, cada destello parecía responder a su respiración. Eliana tomó la linterna de emergencia y salió antes de poder convencerse de que seguía soñando.',
            ],
          ],
          [
            'mensaje',
            '002',
            'El mensaje incompleto',
            'DONE',
            [
              'Eliana regresó de la colina con las botas cubiertas de barro y un papel húmedo apretado dentro del abrigo. No recordaba haberlo visto en la atalaya, pero la tinta azul se encendía cada vez que acercaba la carta a la luz de la cocina.',
              'Solo pudo leer una frase antes de que el resto se deshiciera: “La Semilla despierta cuando el valle olvida sus nombres”. Necesitaba encontrar a alguien que conociera las historias que su abuelo nunca terminaba de contar.',
            ],
          ],
        ],
      ],
      [
        '002',
        'La puerta antigua',
        [
          [
            'biblioteca',
            '001',
            'Bajo la biblioteca',
            'REVIEW',
            [
              'Adrián condujo a Eliana por el Archivo Municipal hasta una estantería cubierta de legajos sin clasificar. Detrás de los documentos prohibidos encontraron una argolla oxidada; al tirar de ella, una parte del suelo cedió con un gemido de piedra.',
              'La escalera descendía hacia una sala sin ventanas. En las paredes había nombres tachados una y otra vez, como si alguien hubiera intentado borrar a los Vigilantes del Valle de todos los registros del pueblo.',
            ],
          ],
          [
            'guardian',
            '002',
            'El guardián de piedra',
            'REVIEW',
            [
              'Al final de la escalera, una estatua con el rostro erosionado bloqueaba la puerta de una cámara antigua. Cuando Eliana acercó el papel de tinta azul, el guardián abrió los ojos y preguntó qué verdad estaba dispuesta a conservar.',
              'Eliana admitió que había visto la señal y que temía que la leyenda fuera cierta. La piedra se apartó lentamente, dejando al descubierto un mapa de rutas que unía la atalaya con el norte.',
            ],
          ],
        ],
      ],
    ],
  ],
  [
    '002',
    'El Mapa de Sombras',
    [
      [
        '001',
        'Cartas desde el norte',
        [
          [
            'sello',
            '001',
            'El sello roto',
            'IN_PROGRESS',
            [
              'Una carta llegó al Archivo antes del amanecer. El sello de los Vigilantes estaba quebrado y el papel olía a humo frío. Adrián reconoció la marca de un puesto abandonado en la ruta del norte.',
              'La advertencia era breve: alguien había encontrado una segunda luz azul y estaba borrando los nombres de quienes intentaban seguirla. Eliana decidió que no podía esperar a que el Consejo cerrara el Archivo.',
            ],
          ],
          [
            'ruta',
            '002',
            'La ruta helada',
            'IN_PROGRESS',
            [
              'Eliana y Adrián partieron con una linterna, la carta y una copia del mapa escondida entre las páginas de un libro de cuentas. El camino del norte estaba cubierto de hielo y ningún carruaje aceptaba llevarlos más allá del bosque.',
              'Durante la marcha, Adrián confesó que había pertenecido a los Vigilantes del Valle. Eliana entendió entonces que la señal era una llamada dirigida a quienes aún recordaban el pacto.',
            ],
          ],
        ],
      ],
      [
        '002',
        'El archivo sellado',
        [
          [
            'nombres',
            '001',
            'Nombres tachados',
            'DRAFT',
            [
              'En una estación abandonada encontraron un registro de familias del valle. Cada vez que aparecía el símbolo de la Semilla de Luz, el nombre había sido raspado con violencia hasta romper el papel.',
              'Adrián descubrió entre las marcas el apellido de la madre de Eliana. Alguien llevaba décadas ocultando que su familia había protegido la atalaya antes de que los Vigilantes desaparecieran.',
            ],
          ],
          [
            'alianza',
            '002',
            'Una alianza incómoda',
            'DRAFT',
            [
              'Mara Voss alcanzó a Eliana y Adrián junto al puente helado. Al principio se acusaron mutuamente de trabajar para quienes habían roto el sello, pero la luz azul apareció de nuevo sobre las montañas.',
              'Frente a la señal, aceptaron colaborar hasta llegar a la fuente. La alianza era frágil, pero todos sabían que el valle no podía permitirse otra noche sin guardianes.',
            ],
          ],
        ],
      ],
    ],
  ],
];

const entities = [
  [
    'eliana',
    'Eliana Vale',
    'CHARACTER',
    'Joven cartógrafa que descubre la señal azul y hereda una deuda con los Vigilantes.',
    ['Eliana'],
    {
      role: 'Protagonista',
      age: 24,
      motivation: 'Recuperar la memoria de su familia',
    },
  ],
  [
    'adrian',
    'Adrián Rivas',
    'CHARACTER',
    'Archivista que conoce los documentos censurados del valle.',
    ['El archivista'],
    { role: 'Mentor ambiguo', age: 42, allegiance: 'Vigilantes del Valle' },
  ],
  [
    'mara',
    'Mara Voss',
    'CHARACTER',
    'Exploradora del norte que persigue la segunda señal.',
    ['La viajera'],
    { role: 'Rival y aliada', motivation: 'Encontrar a su hermana' },
  ],
  [
    'ines',
    'Inés Vale',
    'CHARACTER',
    'Madre desaparecida de Eliana y antigua protectora de la atalaya.',
    ['I. Vale'],
    { status: 'Desaparecida', allegiance: 'Vigilantes del Valle' },
  ],
  [
    'casa',
    'Casa del páramo',
    'LOCATION',
    'Casa familiar desde cuya ventana se ve la atalaya.',
    ['Casa de Eliana'],
    { region: 'Límites del pueblo', state: 'Habitable' },
  ],
  [
    'atalaya',
    'Atalaya antigua',
    'LOCATION',
    'Torre clausurada que vuelve a emitir una luz azul.',
    ['La torre derrumbada'],
    { region: 'Colina del valle', state: 'Despierta' },
  ],
  [
    'archivo',
    'Archivo Municipal',
    'LOCATION',
    'Archivo que oculta una cámara bajo su sala principal.',
    ['El Archivo'],
    { region: 'Centro del pueblo', state: 'Vigilado' },
  ],
  [
    'linterna',
    'Linterna de emergencia',
    'OBJECT',
    'Linterna de latón que perteneció a Inés y reacciona ante la señal.',
    ['La linterna'],
    { owner: 'Eliana Vale', material: 'Latón' },
  ],
  [
    'carta',
    'Carta del sello roto',
    'OBJECT',
    'Advertencia llegada desde el norte con el sello de los Vigilantes quebrado.',
    ['La carta'],
    { origin: 'Puesto Boreal', ink: 'Azul' },
  ],
  [
    'vigilantes',
    'Vigilantes del Valle',
    'ORGANIZATION',
    'Orden antigua dedicada a proteger las atalayas.',
    ['Los Vigilantes'],
    { status: 'Dispersa', founded: '1771' },
  ],
  [
    'consejo',
    'Consejo de Bruma',
    'ORGANIZATION',
    'Autoridad que controla la versión oficial de la historia.',
    ['El Consejo'],
    { reputation: 'Hermética', leader: 'Prefecta Oria' },
  ],
  [
    'senal',
    'La señal azul',
    'EVENT',
    'Resplandor imposible que pulsa desde la atalaya.',
    ['El pulso azul'],
    { status: 'Activo', frequency: 'Cada tercera noche' },
  ],
  [
    'semilla',
    'Semilla de Luz',
    'CONCEPT',
    'Leyenda asociada a una memoria viva bajo el valle.',
    ['La Semilla'],
    { status: 'En investigación', cost: 'Un recuerdo verdadero' },
  ],
  [
    'borrado',
    'El borrado de los nombres',
    'CONCEPT',
    'Práctica de eliminar identidades de la historia oficial.',
    ['Los nombres tachados'],
    { status: 'Oculto', responsible: 'Consejo de Bruma' },
  ],
];

const relations = [
  ['eliana', 'adrian', 'ALLY', 'Investigan juntos la señal.', 'biblioteca'],
  [
    'adrian',
    'eliana',
    'MENTOR',
    'Adrián enseña a Eliana a leer las marcas.',
    'biblioteca',
  ],
  [
    'eliana',
    'mara',
    'RIVAL',
    'Ambas quieren llegar primero a la fuente.',
    'alianza',
  ],
  ['eliana', 'ines', 'FAMILY', 'Inés es la madre de Eliana.', null],
  [
    'eliana',
    'linterna',
    'OWNS',
    'Eliana hereda la linterna de su madre.',
    'ventana',
  ],
  ['adrian', 'vigilantes', 'MEMBER_OF', 'Adrián perteneció a la orden.', null],
  ['ines', 'vigilantes', 'MEMBER_OF', 'Inés protegía la atalaya.', null],
  [
    'vigilantes',
    'atalaya',
    'LOCATED_IN',
    'La orden mantiene un santuario bajo la atalaya.',
    null,
  ],
  ['consejo', 'vigilantes', 'ENEMY', 'El Consejo persiguió a la orden.', null],
  ['carta', 'archivo', 'LOCATED_IN', 'La carta queda bajo custodia.', 'sello'],
];

const timeline = [
  [
    'Los Vigilantes sellan la Atalaya',
    'La orden encierra la Semilla después de una revuelta.',
    '1771-10-02',
    'Hace más de un siglo',
    'HIGH',
    'semilla',
    'ventana',
    ['atalaya', 'vigilantes', 'semilla'],
  ],
  [
    'El Consejo inicia el borrado',
    'Los registros pierden los nombres de los protectores.',
    '1849',
    'Treinta y ocho años antes',
    'HIGH',
    'archivo',
    'biblioteca',
    ['consejo', 'vigilantes', 'borrado'],
  ],
  [
    'Desaparece Inés Vale',
    'Inés parte hacia la atalaya sin regresar.',
    '1875-06-12',
    'Doce años antes',
    'HIGH',
    'familia',
    'nombres',
    ['ines', 'eliana', 'atalaya'],
  ],
  [
    'Eliana observa la señal azul',
    'La atalaya emite tres pulsos.',
    '1887-10-14',
    'A las 3:14',
    'HIGH',
    'semilla',
    'ventana',
    ['eliana', 'casa', 'atalaya', 'senal'],
  ],
  [
    'Aparece el mensaje incompleto',
    'La tinta azul vincula la señal con los nombres olvidados.',
    '1887-10-15',
    'A la mañana siguiente',
    'MEDIUM',
    'semilla',
    'mensaje',
    ['eliana', 'semilla', 'borrado'],
  ],
  [
    'Descubren la cámara bajo el Archivo',
    'Una escalera conduce a los registros ocultos.',
    '1887-10-18',
    'Tres días después',
    'HIGH',
    'archivo',
    'biblioteca',
    ['eliana', 'adrian', 'archivo'],
  ],
  [
    'El guardián exige una verdad',
    'La estatua abre la cámara ante la confesión de Eliana.',
    '1887-10-18',
    'Durante la exploración',
    'MEDIUM',
    'semilla',
    'guardian',
    ['eliana', 'semilla'],
  ],
  [
    'Llega la carta del sello roto',
    'La advertencia confirma una segunda luz al norte.',
    '1887-10-20',
    'Antes de la partida',
    'HIGH',
    'archivo',
    'sello',
    ['adrian', 'carta', 'vigilantes'],
  ],
  [
    'Adrián revela su pasado',
    'Admite que abandonó a los Vigilantes.',
    '1887-10-21',
    'Al amanecer',
    'MEDIUM',
    'familia',
    'ruta',
    ['eliana', 'adrian', 'vigilantes'],
  ],
  [
    'Se revela el nombre de Inés',
    'Un registro vincula a la madre de Eliana con la atalaya.',
    '1887-10-24',
    'En la estación abandonada',
    'HIGH',
    'familia',
    'nombres',
    ['eliana', 'ines', 'borrado'],
  ],
  [
    'Mara propone una alianza',
    'Los tres viajeros acuerdan llegar juntos a la fuente.',
    '1887-10-25',
    'Junto al puente helado',
    'MEDIUM',
    'alianza',
    'alianza',
    ['eliana', 'adrian', 'mara', 'senal'],
  ],
];

const doc = (paragraphs) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })),
});
const countWords = (paragraphs) =>
  paragraphs.join(' ').trim().split(/\s+/).length;
/** Serializes objects with sorted keys so equivalent snapshots hash identically. */
const stableStringify = (value) => {
  if (Array.isArray(value))
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};
/** Returns a hexadecimal SHA-256 digest for a string value. */
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
/** Hashes a structured value using the seed's stable JSON representation. */
const contentHash = (value) => sha256(stableStringify(value));
/** Creates the deterministic source marker used to identify seeded proposals. */
const demoMarker = (key) => sha256(`plumia-demo:${key}`);
/** Creates a stable UUID-shaped share slug for a demo project. */
const demoSlug = (projectId) => {
  const hash = sha256(`plumia-demo-share:${projectId}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

/** Finds or creates the demo project for each selected active account. */
async function resolveProjects() {
  if (process.env.SEED_PROJECT_ID) {
    const project = await prisma.project.findFirst({
      where: { id: process.env.SEED_PROJECT_ID, deletedAt: null },
    });
    if (!project)
      throw new Error('SEED_PROJECT_ID no corresponde a un proyecto activo.');
    if (process.env.SEED_USER_ID && project.userId !== process.env.SEED_USER_ID)
      throw new Error('SEED_PROJECT_ID no pertenece al SEED_USER_ID indicado.');
    if (process.env.SEED_USER_EMAIL) {
      const owner = await prisma.user.findUnique({
        where: { id: project.userId },
        select: { email: true },
      });
      if (owner?.email.toLowerCase() !== process.env.SEED_USER_EMAIL.trim().toLowerCase())
        throw new Error('SEED_PROJECT_ID no pertenece al SEED_USER_EMAIL indicado.');
    }
    return [project];
  }

  const explicitUser = process.env.SEED_USER_ID || process.env.SEED_USER_EMAIL;
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      ...(process.env.SEED_USER_ID ? { id: process.env.SEED_USER_ID } : {}),
      ...(process.env.SEED_USER_EMAIL
        ? { email: process.env.SEED_USER_EMAIL.trim().toLowerCase() }
        : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
  if (explicitUser && users.length !== 1)
    throw new Error('SEED_USER_ID o SEED_USER_EMAIL no corresponde a una cuenta activa.');
  if (users.length === 0)
    throw new Error('No hay cuentas activas para cargar el proyecto demo.');

  const title = process.env.SEED_PROJECT_TITLE || PROJECT_TITLE;
  const projects = [];
  for (const user of users) {
    const found = await prisma.project.findMany({
      where: { title, userId: user.id, deletedAt: null },
      take: 2,
    });
    if (found.length > 1)
      throw new Error(
        `Hay más de un proyecto “${title}” para una cuenta; definí SEED_PROJECT_ID.`,
      );
    projects.push(
      found[0] ??
        (await prisma.project.create({
          data: {
            userId: user.id,
            title,
            description:
              'Novela fantástica de misterio sobre la memoria y los nombres perdidos.',
            genre: 'Fantasía de misterio',
            genreRules: {
              tone: 'Atmosférico y esperanzador',
              audience: 'Young adult y adulto',
            },
            wordCountTarget: 80000,
          },
        })),
    );
  }
  return projects;
}

/** Refuses to seed unless both Prisma URLs point to a local PostgreSQL host. */
function assertLocalDatabase() {
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  for (const [name, value] of [
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['DIRECT_URL', process.env.DIRECT_URL],
  ]) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} debe apuntar a una base PostgreSQL local.`);
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !localHosts.has(hostname)
    )
      throw new Error(
        `Seed bloqueado: ${name} debe usar localhost, 127.0.0.1 o ::1.`,
      );
  }
}

async function seedManuscript(projectId) {
  const bookIds = new Map(),
    chapterIds = new Map(),
    sceneIds = new Map();
  let order = 1;
  for (const [bookKey, title, chapters] of books) {
    let book = await prisma.book.findFirst({
      where: { projectId, sortKey: bookKey, deletedAt: null },
    });
    book = book
      ? await prisma.book.update({ where: { id: book.id }, data: { title } })
      : await prisma.book.create({
          data: { projectId, title, sortKey: bookKey },
        });
    bookIds.set(bookKey, book.id);
    for (const [chapterKey, chapterTitle, scenes] of chapters) {
      let chapter = await prisma.chapter.findFirst({
        where: { bookId: book.id, sortKey: chapterKey, deletedAt: null },
      });
      chapter = chapter
        ? await prisma.chapter.update({
            where: { id: chapter.id },
            data: { title: chapterTitle },
          })
        : await prisma.chapter.create({
            data: { bookId: book.id, title: chapterTitle, sortKey: chapterKey },
          });
      chapterIds.set(`${bookKey}:${chapterKey}`, chapter.id);
      let chapterWords = 0;
      for (const [
        sceneKey,
        sortKey,
        sceneTitle,
        status,
        paragraphs,
      ] of scenes) {
        const wordCount = countWords(paragraphs);
        chapterWords += wordCount;
        let scene = await prisma.scene.findFirst({
          where: { chapterId: chapter.id, sortKey, deletedAt: null },
        });
        const data = {
          title: sceneTitle,
          status,
          content: doc(paragraphs),
          wordCount,
          order,
        };
        scene = scene
          ? await prisma.scene.update({ where: { id: scene.id }, data })
          : await prisma.scene.create({
              data: { chapterId: chapter.id, sortKey, ...data },
            });
        sceneIds.set(sceneKey, scene.id);
        order += 1;
      }
      await prisma.chapter.update({
        where: { id: chapter.id },
        data: {
          wordCount: chapterWords,
          status: scenes.every((scene) => scene[3] === 'DONE')
            ? 'DONE'
            : 'IN_PROGRESS',
        },
      });
    }
  }
  return { bookIds, chapterIds, sceneIds };
}

async function seedKnowledge(projectId, sceneIds) {
  const ids = new Map();
  for (const [
    key,
    canonicalName,
    type,
    description,
    aliases,
    attributes,
  ] of entities) {
    let entity = await prisma.entity.findFirst({
      where: { projectId, canonicalName, type, deletedAt: null },
    });
    const data = {
      description,
      aliases,
      attributes,
      source: 'author_manual',
      confidenceScore: 1,
      userLockedFields: key === 'eliana' ? ['description'] : [],
      isActive: true,
    };
    entity = entity
      ? await prisma.entity.update({ where: { id: entity.id }, data })
      : await prisma.entity.create({
          data: { projectId, canonicalName, type, ...data },
        });
    ids.set(key, entity.id);
  }
  const povs = {
    ventana: 'eliana',
    mensaje: 'eliana',
    biblioteca: 'adrian',
    guardian: 'eliana',
    sello: 'adrian',
    ruta: 'eliana',
    nombres: 'eliana',
    alianza: 'mara',
  };
  for (const [scene, entity] of Object.entries(povs))
    await prisma.scene.update({
      where: { id: sceneIds.get(scene) },
      data: { povCharacterId: ids.get(entity) },
    });
  for (const [source, target, relationType, description, scene] of relations) {
    const where = {
      projectId,
      sourceEntityId: ids.get(source),
      targetEntityId: ids.get(target),
      relationType,
      validFromSceneId: scene ? sceneIds.get(scene) : null,
    };
    const existing = await prisma.relationship.findFirst({ where });
    if (existing)
      await prisma.relationship.update({
        where: { id: existing.id },
        data: { description, source: 'author_manual', confidenceScore: 1 },
      });
    else
      await prisma.relationship.create({
        data: {
          ...where,
          description,
          source: 'author_manual',
          confidenceScore: 1,
        },
      });
  }
  const states = [
    [
      'eliana',
      'conocimiento_de_la_orden',
      'Desconoce a los Vigilantes',
      'Conoce su legado',
      'biblioteca',
    ],
    ['adrian', 'lealtad', 'Oculta', 'Confesada', 'ruta'],
    ['atalaya', 'estado', 'Sellada', 'Activa', 'ventana'],
  ];
  for (const [entity, attributeKey, fromValue, toValue, scene] of states) {
    const where = {
      entityId: ids.get(entity),
      attributeKey,
      validFromSceneId: sceneIds.get(scene),
    };
    const existing = await prisma.entityState.findFirst({ where });
    if (!existing)
      await prisma.entityState.create({
        data: {
          ...where,
          fromValue,
          toValue,
          source: 'author_manual',
          confidenceScore: 1,
        },
      });
  }
  const facts = [
    ['adrian', 'Adrián perteneció a los Vigilantes del Valle.', 'ruta'],
    [
      'ines',
      'El registro identifica a Inés como protectora de la atalaya.',
      'nombres',
    ],
    [
      'semilla',
      'La Semilla despierta cuando el valle olvida sus nombres.',
      'mensaje',
    ],
  ];
  for (const [entity, content, scene] of facts) {
    const where = {
      entityId: ids.get(entity),
      content,
      sourceSceneId: sceneIds.get(scene),
    };
    if (!(await prisma.fact.findFirst({ where })))
      await prisma.fact.create({
        data: { ...where, epistemicType: 'OBJECTIVE', confidenceScore: 1 },
      });
  }
  return ids;
}

async function seedPlot(projectId, entityIds, sceneIds, chapterIds) {
  const arcIds = new Map();
  const arcs = [
    ['semilla', 'El despertar de la Semilla'],
    ['archivo', 'Los secretos del Archivo'],
    ['familia', 'La memoria de los Vale'],
    ['alianza', 'La alianza incómoda'],
  ];
  for (const [index, [key, title]] of arcs.entries()) {
    const sortKey = String(900001 + index);
    let arc = await prisma.storyboardArc.findFirst({
      where: { projectId, sortKey, deletedAt: null },
    });
    arc = arc
      ? await prisma.storyboardArc.update({
          where: { id: arc.id },
          data: { title },
        })
      : await prisma.storyboardArc.create({
          data: { projectId, title, sortKey },
        });
    arcIds.set(key, arc.id);
  }
  for (const [
    index,
    [title, description, date, temporalLabel, impact, arc, scene, entityKeys],
  ] of timeline.entries()) {
    let event = await prisma.timelineEvent.findFirst({
      where: { projectId, title, deletedAt: null },
    });
    const data = {
      description,
      date,
      temporalLabel,
      impact,
      storyboardArcId: arcIds.get(arc),
      sourceSceneId: sceneIds.get(scene),
      position: (index + 1) * 1000,
      source: 'author_manual',
      confidenceScore: 1,
    };
    if (event) {
      event = await prisma.timelineEvent.update({
        where: { id: event.id },
        data,
      });
      await prisma.timelineEventEntity.deleteMany({
        where: { timelineEventId: event.id },
      });
      await prisma.timelineEventEntity.createMany({
        data: entityKeys.map((key) => ({
          timelineEventId: event.id,
          entityId: entityIds.get(key),
        })),
      });
    } else
      await prisma.timelineEvent.create({
        data: {
          projectId,
          title,
          ...data,
          entities: {
            create: entityKeys.map((key) => ({ entityId: entityIds.get(key) })),
          },
        },
      });
  }
  const cards = [
    ['La señal obliga a Eliana a salir', '001:001', 'completed'],
    ['Descifrar el mensaje incompleto', '001:001', 'completed'],
    ['Investigar los archivos prohibidos', '001:002', 'in-progress'],
    ['Cruzar el umbral del guardián', '001:002', 'planned'],
    ['Seguir la carta hacia el norte', '002:001', 'planned'],
    ['Forjar una alianza con Mara', '002:002', 'ideas'],
  ];
  for (const [index, [title, chapter, status]] of cards.entries()) {
    const sortKey = String(900001 + index);
    const existing = await prisma.storyboardNote.findFirst({
      where: { projectId, sortKey, deletedAt: null },
    });
    const data = {
      chapterId: chapterIds.get(chapter),
      title,
      content: `Objetivo narrativo: ${title}.`,
      status,
      tags: ['demo', 'trama'],
      characters: ['Eliana Vale', 'Adrián Rivas'],
      entityIds: [entityIds.get('eliana'), entityIds.get('adrian')],
    };
    if (existing)
      await prisma.storyboardNote.update({ where: { id: existing.id }, data });
    else
      await prisma.storyboardNote.create({
        data: { projectId, sortKey, ...data },
      });
  }
  const matrix = [
    ['semilla', '001:001', 'La señal entrega la primera regla de la Semilla.'],
    ['archivo', '001:002', 'La cámara revela que el borrado fue deliberado.'],
    ['familia', '002:001', 'Adrián confiesa qué ocurrió con Inés.'],
    [
      'familia',
      '002:002',
      'El apellido Vale aparece en el registro censurado.',
    ],
    [
      'alianza',
      '002:002',
      'Mara transforma el conflicto en una cooperación precaria.',
    ],
  ];
  for (const [index, [arc, chapter, content]] of matrix.entries()) {
    const sortKey = String(900001 + index),
      arcId = arcIds.get(arc),
      chapterId = chapterIds.get(chapter);
    const existing = await prisma.storyboardMatrixNote.findFirst({
      where: { arcId, chapterId, sortKey, deletedAt: null },
    });
    if (existing)
      await prisma.storyboardMatrixNote.update({
        where: { id: existing.id },
        data: { content },
      });
    else
      await prisma.storyboardMatrixNote.create({
        data: { arcId, chapterId, sortKey, content },
      });
  }
}

const upsertSummary = (
  projectId,
  scopeType,
  scopeId,
  title,
  content,
  parentSummaryId = null,
) =>
  prisma.summary.upsert({
    where: { scopeType_scopeId: { scopeType, scopeId } },
    create: {
      projectId,
      scopeType,
      scopeId,
      title,
      content,
      parentSummaryId,
      source: 'author_manual',
    },
    update: {
      title,
      content,
      parentSummaryId,
      source: 'author_manual',
      isDirty: false,
    },
  });

async function seedSummaries(projectId, bookIds, chapterIds, sceneIds) {
  const parents = new Map();
  for (const [key, title, content] of [
    [
      '001',
      'La Semilla de Luz',
      'La señal despierta, conduce a Eliana hasta el Archivo y revela que la historia censurada del valle continúa viva.',
    ],
    [
      '002',
      'El Mapa de Sombras',
      'Una carta obliga a Eliana y Adrián a viajar al norte, donde el nombre de Inés reaparece y Mara propone una alianza peligrosa.',
    ],
  ])
    parents.set(
      key,
      (await upsertSummary(projectId, 'book', bookIds.get(key), title, content))
        .id,
    );
  for (const [bookKey, , chapters] of books)
    for (const [chapterKey, title, scenes] of chapters) {
      const key = `${bookKey}:${chapterKey}`;
      const chapterSummary = await upsertSummary(
        projectId,
        'chapter',
        chapterIds.get(key),
        title,
        scenes.map((scene) => scene[4].join(' ')).join(' '),
        parents.get(bookKey),
      );
      for (const [sceneKey, , sceneTitle, , paragraphs] of scenes)
        await upsertSummary(
          projectId,
          'scene',
          sceneIds.get(sceneKey),
          sceneTitle,
          paragraphs.join(' '),
          chapterSummary.id,
        );
    }
}

async function seedActivity(project, sceneIds) {
  for (const [goalType, targetWords] of [
    ['DAILY', 650],
    ['WEEKLY', 3500],
  ]) {
    const existing = await prisma.writingGoal.findFirst({
      where: {
        projectId: project.id,
        userId: project.userId,
        goalType,
        isActive: true,
      },
    });
    if (existing)
      await prisma.writingGoal.update({
        where: { id: existing.id },
        data: { targetWords },
      });
    else
      await prisma.writingGoal.create({
        data: {
          projectId: project.id,
          userId: project.userId,
          goalType,
          targetWords,
        },
      });
  }
  const activity = [
    [-6, 'ventana', 480],
    [-5, 'mensaje', 720],
    [-4, 'biblioteca', 340],
    [-3, 'guardian', 910],
    [-2, 'sello', 560],
    [-1, 'ruta', 780],
    [0, 'nombres', 420],
  ];
  const midnight = new Date(
    `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  for (const [offset, scene, wordsAdded] of activity) {
    const startedAt = new Date(
        midnight.getTime() + offset * 86400000 + 18 * 3600000,
      ),
      durationSecs = 1800;
    const where = {
      projectId: project.id,
      userId: project.userId,
      sceneId: sceneIds.get(scene),
      startedAt,
    };
    if (!(await prisma.writingSession.findFirst({ where })))
      await prisma.writingSession.create({
        data: {
          ...where,
          endedAt: new Date(startedAt.getTime() + durationSecs * 1000),
          durationSecs,
          wordsAdded,
          wordsDeleted: 40,
          wordsNet: wordsAdded - 40,
          avgWpm: Number((wordsAdded / 30).toFixed(1)),
        },
      });
  }
}

async function seedAuditAndChat(projectId, entityIds, sceneIds) {
  const alerts = [
    [
      'demo:linterna',
      'nombres',
      'MEDIUM',
      'CONTINUITY',
      'La procedencia de la linterna cambia',
      'Decidir cuándo descubre Eliana que perteneció a Inés.',
      'linterna',
    ],
    [
      'demo:adrian',
      'ruta',
      'HIGH',
      'CHARACTER',
      'La lealtad de Adrián necesita una pista previa',
      'Preparar su confesión en el capítulo anterior.',
      'adrian',
    ],
    [
      'demo:signal',
      'alianza',
      'LOW',
      'TIMELINE',
      'La segunda señal no tiene fecha precisa',
      'Precisar la fecha para ordenar la cronología.',
      'senal',
    ],
  ];
  for (const [
    seedKey,
    scene,
    severity,
    category,
    title,
    explanation,
    entity,
  ] of alerts) {
    const fingerprint = `demo:${projectId}:${seedKey.replace(/^demo:/, '')}`;
    await prisma.auditAlert.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        projectId,
        sceneId: sceneIds.get(scene),
        detectionLevel: 'INTER_SCENE',
        severity,
        category,
        title,
        description: explanation,
        explanation,
        confidence: 0.86,
        sourceConflict: {
          entityId: entityIds.get(entity),
          entityName: title,
          field: 'continuidad',
          currentValue: 'Versión inicial',
          observedValue: 'Versión posterior',
          evidence: [title],
        },
      },
      update: {
        sceneId: sceneIds.get(scene),
        severity,
        category,
        title,
        description: explanation,
        explanation,
        status: 'ACTIVE',
      },
    });
  }
  let thread = await prisma.chatThread.findFirst({
    where: { projectId, title: 'Ideas para la segunda señal' },
  });
  if (!thread)
    thread = await prisma.chatThread.create({
      data: { projectId, title: 'Ideas para la segunda señal' },
    });
  if (!(await prisma.chatMessage.count({ where: { threadId: thread.id } })))
    await prisma.chatMessage.createMany({
      data: [
        {
          threadId: thread.id,
          role: 'user',
          content: '¿Cómo conecto la segunda señal con Inés sin revelar todo?',
        },
        {
          threadId: thread.id,
          role: 'assistant',
          content:
            'Repetí el patrón de tres pulsos en la linterna de Inés. La conexión queda visible, pero su causa sigue abierta.',
        },
      ],
    });
}

/** Creates or refreshes a demo proposal while preserving reviewed proposals. */
async function upsertPendingSeedProposal(model, key, projectId, data) {
  const sourceChunkHash = demoMarker(key);
  const existing = await model.findFirst({
    where: { projectId, sourceChunkHash },
  });
  const proposalData = { projectId, sourceChunkHash, ...data };
  if (!existing) return model.create({ data: proposalData });
  if (existing.status === 'PENDING')
    return model.update({
      where: { id: existing.id },
      data: proposalData,
    });
  return existing;
}

/** Applies the project settings needed to demonstrate review workflows. */
async function seedProjectSettings(projectId) {
  await prisma.projectEntityRecognitionSettings.upsert({
    where: { projectId },
    create: {
      projectId,
      importantEntityNames: ['Eliana Vale', 'Adrián Rivas', 'Mara Voss'],
      ignoredEntityNames: ['el valle', 'la noche'],
    },
    update: {
      importantEntityNames: ['Eliana Vale', 'Adrián Rivas', 'Mara Voss'],
      ignoredEntityNames: ['el valle', 'la noche'],
    },
  });
  await prisma.projectKnowledgeReviewSettings.upsert({
    where: { projectId },
    create: {
      projectId,
      stateTrackingEnabled: true,
      stateReviewMode: 'MANUAL',
      stateConfidenceThreshold: 0.8,
      relationshipReviewMode: 'MANUAL',
      relationshipConfidenceThreshold: 0.8,
      crossChunkAuditMode: 'SCENE_GROUPED',
    },
    update: {
      stateTrackingEnabled: true,
      stateReviewMode: 'MANUAL',
      stateConfidenceThreshold: 0.8,
      relationshipReviewMode: 'MANUAL',
      relationshipConfidenceThreshold: 0.8,
      crossChunkAuditMode: 'SCENE_GROUPED',
    },
  });
  await prisma.exportSettings.upsert({
    where: { projectId },
    create: {
      projectId,
      marginTopCm: 2.2,
      marginBottomCm: 2.2,
      marginLeftCm: 2.5,
      marginRightCm: 2.5,
      header: {
        text: 'La Semilla de Luz',
        alignment: 'center',
        pageNumber: { enabled: false, format: '1' },
      },
      footer: {
        text: null,
        alignment: 'right',
        pageNumber: { enabled: true, format: 'Página {page}' },
      },
    },
    update: {
      marginTopCm: 2.2,
      marginBottomCm: 2.2,
      marginLeftCm: 2.5,
      marginRightCm: 2.5,
      header: {
        text: 'La Semilla de Luz',
        alignment: 'center',
        pageNumber: { enabled: false, format: '1' },
      },
      footer: {
        text: null,
        alignment: 'right',
        pageNumber: { enabled: true, format: 'Página {page}' },
      },
    },
  });
}

/** Creates repeatable pending entity, state, and relationship proposals. */
async function seedReviewProposals(projectId, entityIds, sceneIds) {
  await upsertPendingSeedProposal(prisma.entityProposal, 'entity:nora-del-faro', projectId, {
    sceneId: sceneIds.get('alianza'),
    entityId: null,
    conflictsWithLocked: false,
    confidenceScore: 0.91,
    narrativeOrder: 8,
    proposedData: {
      canonicalName: 'Nora del Faro',
      aliases: ['La guardiana del norte'],
      type: 'CHARACTER',
      description: 'Mensajera que conoce la ruta hacia la segunda atalaya.',
      attributes: { role: 'Mensajera', allegiance: 'desconocida' },
      imageUrl: null,
      proposalKind: 'NEW_ENTITY',
      confidenceScore: 0.91,
      sourceSceneId: sceneIds.get('alianza'),
      sourceSceneTitle: 'Una alianza incómoda',
      evidence: ['Una voz respondió desde el faro apagado.'],
      normalizedName: 'nora del faro',
    },
  });
  await upsertPendingSeedProposal(prisma.entityProposal, 'entity:eliana-description-conflict', projectId, {
    sceneId: sceneIds.get('nombres'),
    entityId: entityIds.get('eliana'),
    conflictsWithLocked: true,
    confidenceScore: 0.84,
    narrativeOrder: 7,
    proposedData: {
      canonicalName: 'Eliana Vale',
      aliases: ['Eliana', 'La cartógrafa'],
      type: 'CHARACTER',
      description: 'Cartógrafa que heredó el juramento de proteger la Semilla.',
      attributes: {
        role: 'Protagonista',
        age: 24,
        motivation: 'Recuperar la memoria de su familia',
      },
      imageUrl: null,
      proposalKind: 'ENTITY_UPDATE',
      confidenceScore: 0.84,
      sourceSceneId: sceneIds.get('nombres'),
      sourceSceneTitle: 'Nombres tachados',
      evidence: ['El registro une a Eliana con la antigua orden.'],
      normalizedName: 'eliana vale',
    },
  });

  const stateProposals = [
    {
      key: 'state:eliana-location',
      sceneId: sceneIds.get('alianza'),
      entityId: entityIds.get('eliana'),
      attributeKey: 'ubicacion',
      fromValue: 'Estación abandonada',
      toValue: 'Puente helado',
      sequenceKind: 'TRANSITION',
      confidenceScore: 0.89,
      narrativeOrder: 8,
      evidence: ['Eliana y Adrián se reúnen junto al puente helado.'],
    },
    {
      key: 'state:adrian-loyalty-uncertain',
      sceneId: sceneIds.get('ruta'),
      entityId: entityIds.get('adrian'),
      attributeKey: 'lealtad',
      fromValue: 'Oculta',
      toValue: 'Leal a los Vigilantes',
      sequenceKind: 'UNCERTAIN',
      confidenceScore: 0.68,
      narrativeOrder: 6,
      evidence: ['Adrián habla de su pasado, pero evita explicar por qué se fue.'],
    },
  ];
  for (const { key, ...data } of stateProposals)
    await upsertPendingSeedProposal(prisma.entityStateProposal, key, projectId, data);

  const endRelationship = await prisma.relationship.findFirst({
    where: {
      projectId,
      sourceEntityId: entityIds.get('adrian'),
      targetEntityId: entityIds.get('eliana'),
      relationType: 'MENTOR',
    },
  });
  const relationshipProposals = [
    {
      key: 'relationship:mara-knows-ines',
      sceneId: sceneIds.get('alianza'),
      kind: 'CREATE',
      sourceEntityId: entityIds.get('mara'),
      targetEntityId: entityIds.get('ines'),
      relationType: 'KNOWS',
      description: 'Mara siguió una pista que Inés dejó en el norte.',
      intensity: 0.55,
      confidenceScore: 0.82,
      evidence: ['Mara reconoció el sello que Inés usaba en sus cartas.'],
    },
    {
      key: 'relationship:end-adrian-mentor',
      sceneId: sceneIds.get('alianza'),
      relationshipId: endRelationship?.id ?? null,
      kind: 'END',
      sourceEntityId: entityIds.get('adrian'),
      targetEntityId: entityIds.get('eliana'),
      relationType: 'MENTOR',
      description: 'Eliana ya no depende de Adrián para leer las marcas.',
      intensity: 0.35,
      confidenceScore: 0.74,
      evidence: ['Eliana interpreta el mapa sin ayuda de Adrián.'],
    },
  ];
  for (const { key, ...data } of relationshipProposals)
    await upsertPendingSeedProposal(prisma.relationshipProposal, key, projectId, data);
}

/** Creates or updates the alternate scene drafts used by the demo. */
async function seedSceneVersions(sceneIds) {
  const seeds = [
    {
      sceneKey: 'guardian',
      label: 'Alternativa: el guardián recuerda',
      paragraphs: [
        'Al final de la escalera, una estatua con el rostro erosionado bloqueaba la puerta de una cámara antigua. Cuando Eliana acercó el papel de tinta azul, el guardián abrió los ojos y preguntó qué verdad estaba dispuesta a conservar.',
        'Eliana admitió que había visto la señal y que temía que la leyenda fuera cierta. La piedra se apartó lentamente, dejando al descubierto un mapa de rutas que unía la atalaya con el norte.',
        'Antes de dejarlos pasar, el guardián pronunció el nombre de Inés como si la hubiera esperado durante años.',
      ],
    },
    {
      sceneKey: 'alianza',
      label: 'Alternativa: pacto bajo la nieve',
      paragraphs: [
        'Mara Voss alcanzó a Eliana y Adrián junto al puente helado. Al principio se acusaron mutuamente de trabajar para quienes habían roto el sello, pero la luz azul apareció de nuevo sobre las montañas.',
        'Frente a la señal, aceptaron colaborar hasta llegar a la fuente. La alianza era frágil, pero todos sabían que el valle no podía permitirse otra noche sin guardianes.',
        'Los tres dejaron una marca distinta en el mapa para recordar qué parte del camino confiaban a los demás.',
      ],
    },
  ];
  for (const seed of seeds) {
    const sceneId = sceneIds.get(seed.sceneKey);
    const content = doc(seed.paragraphs);
    const data = {
      content,
      contentHash: contentHash(content),
      wordCount: countWords(seed.paragraphs),
    };
    const existing = await prisma.sceneVersion.findFirst({
      where: { sceneId, label: seed.label, deletedAt: null },
    });
    if (existing)
      await prisma.sceneVersion.update({ where: { id: existing.id }, data });
    else
      await prisma.sceneVersion.create({
        data: { sceneId, label: seed.label, ...data },
      });
  }
}

/** Builds an ordered immutable snapshot for a project or a selected book. */
async function buildManuscriptSnapshot(projectId, bookId = null) {
  const [project, snapshotBooks] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { title: true },
    }),
    prisma.book.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(bookId ? { id: bookId } : {}),
      },
      orderBy: { sortKey: 'asc' },
      select: {
        id: true,
        title: true,
        chapters: {
          where: { deletedAt: null },
          orderBy: { sortKey: 'asc' },
          select: {
            id: true,
            title: true,
            scenes: {
              where: { deletedAt: null },
              orderBy: [{ order: 'asc' }, { sortKey: 'asc' }],
              select: { id: true, title: true, content: true, wordCount: true },
            },
          },
        },
      },
    }),
  ]);
  return {
    schemaVersion: 1,
    projectId,
    title: snapshotBooks.length === 1 ? snapshotBooks[0].title : project.title,
    frozenAt: new Date().toISOString(),
    books: snapshotBooks.map((book) => ({
      id: book.id,
      title: book.title,
      chapters: book.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        scenes: chapter.scenes.map((scene) => ({
          id: scene.id,
          title: scene.title,
          content:
            scene.content && typeof scene.content === 'object'
              ? scene.content
              : null,
          wordCount: scene.wordCount,
        })),
      })),
    })),
  };
}

/** Saves the demo's project-level manual checkpoint. */
async function seedProjectVersion(projectId) {
  const snapshot = await buildManuscriptSnapshot(projectId);
  const scenes = snapshot.books.flatMap((book) =>
    book.chapters.flatMap((chapter) => chapter.scenes),
  );
  const label = 'Punto de control · Demo Integral';
  const data = {
    snapshot,
    checksumSha256: contentHash(snapshot),
    wordCount: scenes.reduce((total, scene) => total + scene.wordCount, 0),
    entityCount: await prisma.entity.count({
      where: { projectId, deletedAt: null },
    }),
    sceneCount: scenes.length,
  };
  const existing = await prisma.version.findFirst({
    where: { projectId, label, type: 'manual' },
  });
  if (existing)
    await prisma.version.update({ where: { id: existing.id }, data });
  else
    await prisma.version.create({
      data: { projectId, label, type: 'manual', ...data },
    });
}

/** Seeds versions, a reader link, sample comments, replies, and a private note. */
async function seedVersionsSharingAndComments(project, bookIds, chapterIds, sceneIds) {
  await seedSceneVersions(sceneIds);
  await seedProjectVersion(project.id);

  const sharedSnapshot = await buildManuscriptSnapshot(
    project.id,
    bookIds.get('001'),
  );
  const sharedScenes = sharedSnapshot.books.flatMap((book) =>
    book.chapters.flatMap((chapter) => chapter.scenes),
  );
  const shareVersionLabel = 'Copia para lectores · Demo Integral';
  const shareVersionData = {
    snapshot: sharedSnapshot,
    checksumSha256: contentHash(sharedSnapshot),
    wordCount: sharedScenes.reduce((total, scene) => total + scene.wordCount, 0),
    sceneCount: sharedScenes.length,
  };
  let shareVersion = await prisma.version.findFirst({
    where: { projectId: project.id, label: shareVersionLabel, type: 'shared' },
  });
  shareVersion = shareVersion
    ? await prisma.version.update({
        where: { id: shareVersion.id },
        data: shareVersionData,
      })
    : await prisma.version.create({
        data: {
          projectId: project.id,
          label: shareVersionLabel,
          type: 'shared',
          ...shareVersionData,
        },
      });

  const slug = demoSlug(project.id);
  const readerToken = demoReaderToken(project.id);
  const share = await prisma.shareLink.upsert({
    where: { slug },
    create: {
      projectId: project.id,
      bookId: bookIds.get('001'),
      versionId: shareVersion.id,
      slug,
      tokenHash: sha256(readerToken),
      invitedEmail: project.user.email.toLowerCase(),
      permission: 'COMMENT',
      status: 'ACCEPTED',
      createdById: project.userId,
      acceptedById: project.userId,
      acceptedAt: new Date(),
      allowComments: true,
      includeWiki: true,
      maxReaders: 5,
      readerCount: 1,
      isActive: true,
    },
    update: {
      bookId: bookIds.get('001'),
      versionId: shareVersion.id,
      tokenHash: sha256(readerToken),
      invitedEmail: project.user.email.toLowerCase(),
      permission: 'COMMENT',
      status: 'ACCEPTED',
      acceptedById: project.userId,
      acceptedAt: new Date(),
      allowComments: true,
      includeWiki: true,
      maxReaders: 5,
      readerCount: 1,
      isActive: true,
      revokedAt: null,
    },
  });

  const commentSeeds = [
    {
      sceneKey: 'ventana',
      chapterKey: '001:001',
      selectedText: 'la silueta imposible de la antigua atalaya',
      prefix: 'dibujaba sobre el techo ',
      suffix: '.',
      displayName: 'Camila · Lectura beta',
      body: '¿Podemos conectar esta imagen con los tres pulsos que aparecen después?',
      status: 'OPEN',
      reply: 'Sí, voy a sembrar la conexión en la escena de la linterna.',
    },
    {
      sceneKey: 'nombres',
      chapterKey: '002:002',
      selectedText: 'el apellido de la madre de Eliana',
      prefix: 'Adrián descubrió entre las marcas ',
      suffix: '.',
      displayName: 'Diego · Lector beta',
      body: 'La revelación funciona; quizá convenga anticipar el apellido una escena antes.',
      status: 'RESOLVED',
      reply: 'Agregué una pista en la estación abandonada. Gracias por marcarlo.',
    },
  ];
  for (const seed of commentSeeds) {
    const sceneId = sceneIds.get(seed.sceneKey);
    const paragraphText = books
      .flatMap((book) => book[2])
      .flatMap((chapter) => chapter[2])
      .find((scene) => scene[0] === seed.sceneKey)[4]
      .join('\n\n');
    const selectionStart = paragraphText.indexOf(seed.selectedText);
    if (selectionStart < 0)
      throw new Error(`No se encontró el texto anclado para “${seed.displayName}”.`);
    const isResolved = seed.status === 'RESOLVED';
    const commentData = {
      shareLinkId: share.id,
      versionId: shareVersion.id,
      sceneId,
      chapterId: chapterIds.get(seed.chapterKey),
      snapshotSceneId: sceneId,
      displayName: seed.displayName,
      body: seed.body,
      anchorFrom: selectionStart,
      anchorTo: selectionStart + seed.selectedText.length,
      selectedText: seed.selectedText,
      prefix: seed.prefix,
      suffix: seed.suffix,
      status: seed.status,
      isVisible: true,
      resolvedAt: isResolved ? new Date() : null,
      resolvedById: isResolved ? project.userId : null,
    };
    let comment = await prisma.readerComment.findFirst({
      where: { shareLinkId: share.id, displayName: seed.displayName, body: seed.body },
    });
    comment = comment
      ? await prisma.readerComment.update({
          where: { id: comment.id },
          data: commentData,
        })
      : await prisma.readerComment.create({ data: commentData });

    const authorName = project.user.displayName || project.user.name;
    const statusEvents = [
      { status: 'OPEN', changedByName: seed.displayName, changedById: null },
      ...(isResolved
        ? [{ status: 'RESOLVED', changedByName: authorName, changedById: project.userId }]
        : []),
    ];
    for (const event of statusEvents) {
      const existing = await prisma.readerCommentStatusEvent.findFirst({
        where: {
          commentId: comment.id,
          status: event.status,
          changedByName: event.changedByName,
        },
      });
      if (!existing)
        await prisma.readerCommentStatusEvent.create({
          data: { commentId: comment.id, ...event },
        });
    }
    const reply = await prisma.readerCommentReply.findFirst({
      where: { commentId: comment.id, body: seed.reply },
    });
    if (reply)
      await prisma.readerCommentReply.update({
        where: { id: reply.id },
        data: { displayName: authorName, authorId: project.userId },
      });
    else
      await prisma.readerCommentReply.create({
        data: {
          commentId: comment.id,
          displayName: authorName,
          authorId: project.userId,
          body: seed.reply,
        },
      });
  }

  const annotationSceneId = sceneIds.get('mensaje');
  const annotationBody = 'Revisar el ritmo de la revelación antes de cerrar el capítulo.';
  const annotation = await prisma.authorAnnotation.findFirst({
    where: { sceneId: annotationSceneId, authorId: project.userId, body: annotationBody },
  });
  const annotationData = {
    quote: 'La Semilla despierta cuando el valle olvida sus nombres',
    contextBefore: 'Solo pudo leer una frase antes de que el resto se deshiciera: ',
    contextAfter: '.',
    deletedAt: null,
    resolvedAt: null,
  };
  if (annotation)
    await prisma.authorAnnotation.update({
      where: { id: annotation.id },
      data: annotationData,
    });
  else
    await prisma.authorAnnotation.create({
      data: {
        sceneId: annotationSceneId,
        authorId: project.userId,
        body: annotationBody,
        ...annotationData,
      },
    });

  return { slug, readerToken, shareVersionId: shareVersion.id };
}

/** Populates one project with the full demo manuscript and feature examples. */
async function seedProject(resolvedProject) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: resolvedProject.id },
    include: {
      user: { select: { id: true, name: true, displayName: true, email: true } },
    },
  });
  await prisma.project.update({
    where: { id: project.id },
    data: {
      description:
        'Novela fantástica de misterio sobre la memoria y los nombres perdidos.',
      genre: 'Fantasía de misterio',
      genreRules: {
        tone: 'Atmosférico y esperanzador',
        audience: 'Young adult y adulto',
      },
      wordCountTarget: 80000,
    },
  });
  const { bookIds, chapterIds, sceneIds } = await seedManuscript(project.id);
  const entityIds = await seedKnowledge(project.id, sceneIds);
  await seedProjectSettings(project.id);
  await seedReviewProposals(project.id, entityIds, sceneIds);
  await seedPlot(project.id, entityIds, sceneIds, chapterIds);
  await seedSummaries(project.id, bookIds, chapterIds, sceneIds);
  await seedActivity(project, sceneIds);
  await seedAuditAndChat(project.id, entityIds, sceneIds);
  const { slug, readerToken } = await seedVersionsSharingAndComments(
    project,
    bookIds,
    chapterIds,
    sceneIds,
  );
  const result = await prisma.project.findUnique({
    where: { id: project.id },
    select: {
      title: true,
      _count: {
        select: {
          books: true,
          entities: true,
          relationships: true,
          timelineEvents: true,
          storyboardArcs: true,
          storyboardNotes: true,
          summaries: true,
          auditAlerts: true,
          writingSessions: true,
          entityProposals: true,
          entityStateProposals: true,
          relationshipProposals: true,
          versions: true,
          shareLinks: true,
        },
      },
    },
  });
  return {
    id: project.id,
    title: result.title,
    counts: result._count,
    slug,
    readerToken,
  };
}

/** Validates the target and seeds each eligible local account in sequence. */
async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('El seed demo no se ejecuta en producción.');
  assertLocalDatabase();
  const projects = await resolveProjects();
  const seededProjects = [];
  for (const project of projects)
    seededProjects.push(await seedProject(project));

  console.log(`Demo cargado para ${seededProjects.length} cuenta(s) local(es).`);
  for (const project of seededProjects) {
    console.log(`“${project.title}” (${project.id})`);
    console.log(project.counts);
    console.log(`Editor: http://localhost:3001/projects/${project.id}/editor`);
    console.log(
      `Lectura compartida: http://localhost:3001/shared/${project.slug}?token=${project.readerToken}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
