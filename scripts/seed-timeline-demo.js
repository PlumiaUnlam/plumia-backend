require('dotenv/config');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_TITLE = 'Proyecto Demo PlumIA';
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

async function resolveProject() {
  if (process.env.SEED_PROJECT_ID) {
    const project = await prisma.project.findFirst({
      where: { id: process.env.SEED_PROJECT_ID, deletedAt: null },
    });
    if (!project)
      throw new Error('SEED_PROJECT_ID no corresponde a un proyecto activo.');
    return project;
  }
  const title = process.env.SEED_PROJECT_TITLE || PROJECT_TITLE;
  const found = await prisma.project.findMany({
    where: {
      title,
      deletedAt: null,
      ...(process.env.SEED_USER_ID ? { userId: process.env.SEED_USER_ID } : {}),
    },
    take: 2,
  });
  if (found.length === 1) return found[0];
  if (found.length > 1)
    throw new Error(
      `Hay más de un proyecto “${title}”; definí SEED_PROJECT_ID.`,
    );
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      ...(process.env.SEED_USER_ID ? { id: process.env.SEED_USER_ID } : {}),
    },
    take: 2,
  });
  if (users.length !== 1)
    throw new Error('Se necesita un único usuario activo o SEED_USER_ID.');
  return prisma.project.create({
    data: {
      userId: users[0].id,
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
  });
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
    fingerprint,
    scene,
    severity,
    category,
    title,
    explanation,
    entity,
  ] of alerts)
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

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('El seed demo no se ejecuta en producción.');
  const project = await resolveProject();
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
  await seedPlot(project.id, entityIds, sceneIds, chapterIds);
  await seedSummaries(project.id, bookIds, chapterIds, sceneIds);
  await seedActivity(project, sceneIds);
  await seedAuditAndChat(project.id, entityIds, sceneIds);
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
        },
      },
    },
  });
  console.log(`Datos demo cargados en “${result.title}” (${project.id}).`);
  console.log(result._count);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
