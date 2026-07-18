require('dotenv/config');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const entities = [
  ['eliana', 'Eliana', 'CHARACTER', 'Joven que descubre la señal azul en la antigua atalaya.', ['Eliana Vale'], { role: 'Protagonista', home: 'Casa familiar' }],
  ['adrian', 'Adrián Rivas', 'CHARACTER', 'Archivista que conoce los documentos censurados del valle.', ['El archivista'], { role: 'Investigador', allegiance: 'Vigilantes del Valle' }],
  ['casa', 'Casa familiar de Eliana', 'LOCATION', 'Casa antigua en los límites del pueblo desde cuya ventana se ve la atalaya.', ['La casa del páramo'], { region: 'Límites del pueblo', state: 'Habitable' }],
  ['atalaya', 'Atalaya antigua', 'LOCATION', 'Torre de piedra clausurada que vuelve a emitir una luz azul.', ['La torre derrumbada'], { region: 'Colina del valle', state: 'En ruinas' }],
  ['linterna', 'Linterna de emergencia', 'OBJECT', 'Linterna que Eliana toma antes de salir a la noche helada.', ['La linterna'], { owner: 'Eliana', state: 'Funcional' }],
  ['carta', 'Carta del sello roto', 'OBJECT', 'Carta con una advertencia urgente llegada desde el norte.', ['La carta'], { state: 'Abierta', origin: 'Norte' }],
  ['vigilantes', 'Vigilantes del Valle', 'ORGANIZATION', 'Antigua orden vinculada a la Semilla de Luz y a la protección de la atalaya.', ['Los Vigilantes'], { purpose: 'Custodiar el valle', status: 'Dispersa' }],
  ['archivo', 'Archivo Municipal', 'ORGANIZATION', 'Institución que conserva y oculta documentos prohibidos.', ['El Archivo'], { purpose: 'Conservar registros', reputation: 'Hermética' }],
  ['senal', 'La señal azul', 'EVENT', 'Resplandor imposible que pulsa desde la atalaya durante la madrugada.', ['El pulso azul'], { firstWitness: 'Eliana', status: 'Activo' }],
  ['sello', 'Ruptura del sello', 'EVENT', 'La llegada de una carta con el sello quebrado activa la advertencia del norte.', ['El sello roto'], { consequence: 'Advertencia urgente', status: 'Confirmado' }],
  ['semilla', 'Semilla de Luz', 'CONCEPT', 'Leyenda del valle asociada a la luz que despierta en la atalaya.', ['La Semilla'], { domain: 'Leyenda local', status: 'En investigación' }],
  ['nombres', 'Nombres tachados', 'CONCEPT', 'Práctica de borrar identidades de la historia oficial.', ['El borrado'], { domain: 'Memoria histórica', status: 'Oculto' }],
];

const arcs = [
  ['semilla', 'El despertar de la Semilla', '900001'],
  ['archivo', 'Secretos del Archivo', '900002'],
  ['alianza', 'La alianza incómoda', '900003'],
];

const chapterTitles = {
  llamado: 'Capítulo 1: El llamado',
  biblioteca: 'Capítulo 2: La puerta antigua',
  cartas: 'Capítulo 1: Cartas desde el norte',
  archivo: 'Capítulo 2: El archivo sellado',
};

const sceneTitles = [
  'Escena 1: Una luz en la ventana',
  'Escena 2: El mensaje incompleto',
  'Escena 1: Bajo la biblioteca',
  'Escena 2: El guardián de piedra',
  'Escena 1: El sello roto',
  'Escena 2: La ruta helada',
  'Escena 1: Nombres tachados',
  'Escena 2: Una alianza incómoda',
];

const sceneContent = {
  'Escena 2: El mensaje incompleto': [
    'Eliana regresó de la colina con las botas cubiertas de barro y un papel húmedo apretado dentro del abrigo. No recordaba haberlo visto en la Atalaya, pero la tinta azul se encendía cada vez que acercaba la carta a la luz de la cocina.',
    'Solo pudo leer una frase antes de que el resto se deshiciera: “La Semilla despierta cuando el valle olvida sus nombres”. Eliana comprendió que necesitaba buscar a alguien que conociera las historias que su abuelo nunca terminaba de contar.',
  ],
  'Escena 1: Bajo la biblioteca': [
    'Adrián condujo a Eliana por el Archivo Municipal hasta una estantería cubierta de legajos sin clasificar. Detrás de los documentos prohibidos encontraron una argolla oxidada; al tirar de ella, una parte del suelo cedió con un gemido de piedra.',
    'La escalera descendía hacia una sala sin ventanas. En las paredes había nombres tachados una y otra vez, como si alguien hubiera intentado borrar a los Vigilantes del Valle de todos los registros del pueblo.',
  ],
  'Escena 2: El guardián de piedra': [
    'Al final de la escalera, una estatua con el rostro erosionado bloqueaba la puerta de una cámara antigua. Cuando Eliana acercó el papel de tinta azul, el guardián abrió los ojos y preguntó qué verdad estaba dispuesta a conservar.',
    'Adrián quiso mentir para protegerla, pero Eliana admitió que había visto la señal y que temía que la leyenda fuera cierta. La piedra se apartó lentamente, dejando al descubierto un mapa de rutas que unía la Atalaya con el norte.',
  ],
  'Escena 1: El sello roto': [
    'Una carta llegó al Archivo antes del amanecer. El sello de los Vigilantes estaba quebrado y el papel olía a humo frío. Adrián reconoció la marca de un puesto abandonado en la ruta del norte.',
    'La advertencia era breve: alguien había encontrado una segunda luz azul y estaba borrando los nombres de quienes intentaban seguirla. Eliana decidió que no podía esperar a que el Consejo del pueblo cerrara el Archivo.',
  ],
  'Escena 2: La ruta helada': [
    'Eliana y Adrián partieron con una linterna, la carta y una copia del mapa escondida entre las páginas de un libro de cuentas. El camino del norte estaba cubierto de hielo y ningún carruaje aceptaba llevarlos más allá del bosque.',
    'Durante la marcha, Adrián confesó que había pertenecido a los Vigilantes del Valle. Eliana entendió entonces que la señal no era un accidente: era una llamada dirigida a quienes aún recordaban el pacto.',
  ],
  'Escena 1: Nombres tachados': [
    'En una estación abandonada encontraron un registro de familias del valle. Cada vez que aparecía el símbolo de la Semilla de Luz, el nombre había sido raspado con violencia hasta romper el papel.',
    'Adrián descubrió entre las marcas el apellido de la madre de Eliana. La omisión no era casual: alguien llevaba décadas ocultando que su familia había protegido la Atalaya antes que los Vigilantes desaparecieran.',
  ],
  'Escena 2: Una alianza incómoda': [
    'Dos viajeros que perseguían la misma ruta alcanzaron a Eliana y Adrián junto al puente helado. Al principio se acusaron mutuamente de trabajar para quienes habían roto el sello, pero la luz azul apareció de nuevo sobre las montañas.',
    'Frente a la señal, aceptaron colaborar hasta llegar a la fuente. La alianza era frágil, pero todos sabían que el valle no podía permitirse otra noche sin guardianes.',
  ],
};

const timeline = [
  ['leyenda', 'Los Vigilantes sellan la Atalaya', '1771-10-02', 'Hace más de un siglo', 'HIGH', null, ['atalaya', 'vigilantes', 'semilla']],
  ['luz', 'Eliana observa la señal azul', '1887-10-14', 'A las 3:14 de la madrugada', 'HIGH', 'semilla', ['eliana', 'casa', 'atalaya', 'senal']],
  ['salida', 'Eliana sale hacia la Atalaya', '1887-10-14', 'Poco después de ver la señal', 'MEDIUM', 'semilla', ['eliana', 'linterna', 'atalaya']],
  ['mensaje', 'Aparece el mensaje incompleto', '1887-10-15', 'A la mañana siguiente', 'MEDIUM', 'semilla', ['eliana', 'semilla', 'vigilantes']],
  ['escalera', 'Descubren la escalera bajo la biblioteca', '1887-10-18', 'Unos días después', 'HIGH', 'archivo', ['eliana', 'archivo', 'nombres']],
  ['guardian', 'El guardián de piedra exige una verdad', '1887-10-18', 'Durante la exploración subterránea', 'MEDIUM', 'archivo', ['eliana', 'atalaya', 'semilla']],
  ['carta', 'Llega la carta del sello roto', '1887-10-20', 'Antes de la partida al norte', 'HIGH', 'archivo', ['adrian', 'carta', 'sello']],
  ['ruta', 'El grupo toma la ruta helada', '1887-10-21', 'Al amanecer siguiente', 'LOW', 'archivo', ['eliana', 'adrian', 'carta']],
  ['borrado', 'Se revelan los nombres tachados', '1887-10-24', 'Tras hallar el registro oculto', 'HIGH', null, ['archivo', 'nombres', 'adrian']],
  ['alianza', 'Dos rivales aceptan colaborar', '1887-10-25', 'Al final del viaje', 'MEDIUM', 'alianza', ['eliana', 'adrian', 'vigilantes']],
];

async function project() {
  const id = process.env.SEED_PROJECT_ID;
  const matches = await prisma.project.findMany({
    where: { deletedAt: null, ...(id ? { id } : {}) },
    orderBy: { createdAt: 'asc' },
    take: id ? 1 : 2,
    select: { id: true, title: true },
  });
  if (!matches.length) throw new Error('No se encontró el proyecto indicado.');
  if (!id && matches.length > 1) throw new Error('Hay más de un proyecto: definí SEED_PROJECT_ID.');
  return matches[0];
}

function toDocument(paragraphs) {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

async function ensureSceneContent(projectId) {
  for (const [title, paragraphs] of Object.entries(sceneContent)) {
    const scene = await prisma.scene.findFirst({
      where: { title, deletedAt: null, chapter: { book: { projectId } } },
      select: { id: true },
    });
    if (!scene) continue;
    const wordCount = paragraphs.join(' ').split(/\s+/).length;
    await prisma.scene.update({
      where: { id: scene.id },
      data: { content: toDocument(paragraphs), wordCount },
    });
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Este seed no puede ejecutarse en producción.');
  const currentProject = await project();
  const chapters = await prisma.chapter.findMany({
    where: { deletedAt: null, book: { projectId: currentProject.id, deletedAt: null } },
    select: { id: true, title: true },
  });
  const chapterByTitle = new Map(chapters.map((chapter) => [chapter.title, chapter.id]));
  if (Object.values(chapterTitles).some((title) => !chapterByTitle.has(title))) {
    throw new Error('Faltan los capítulos demo esperados; este seed está preparado para Proyecto Demo PlumIA.');
  }
  await ensureSceneContent(currentProject.id);
  const scenes = await prisma.scene.findMany({
    where: { deletedAt: null, chapter: { book: { projectId: currentProject.id } } },
    select: { id: true, title: true },
  });
  const sceneIds = sceneTitles.map((title) => scenes.find((scene) => scene.title === title)?.id).filter(Boolean);

  const entityIds = new Map();
  for (const [key, name, type, description, aliases, attributes] of entities) {
    let entity = await prisma.entity.findFirst({ where: { projectId: currentProject.id, canonicalName: name, type, deletedAt: null }, select: { id: true } });
    if (!entity) entity = await prisma.entity.create({ data: { projectId: currentProject.id, canonicalName: name, type, description, aliases, attributes, source: 'author_manual', confidenceScore: 1 }, select: { id: true } });
    entityIds.set(key, entity.id);
  }

  const arcIds = new Map();
  for (const [key, title, sortKey] of arcs) {
    let arc = await prisma.storyboardArc.findFirst({ where: { projectId: currentProject.id, title, deletedAt: null }, select: { id: true } });
    if (!arc) arc = await prisma.storyboardArc.create({ data: { projectId: currentProject.id, title, sourceType: 'custom', sortKey }, select: { id: true } });
    arcIds.set(key, arc.id);
  }

  const relations = [['eliana', 'adrian', 'ALLY'], ['adrian', 'eliana', 'MENTOR'], ['eliana', 'linterna', 'OWNS'], ['vigilantes', 'atalaya', 'LOCATED_IN'], ['adrian', 'archivo', 'MEMBER_OF'], ['archivo', 'vigilantes', 'ENEMY']];
  for (const [sourceKey, targetKey, relationType] of relations) {
    const sourceEntityId = entityIds.get(sourceKey); const targetEntityId = entityIds.get(targetKey);
    const exists = await prisma.relationship.findFirst({ where: { projectId: currentProject.id, sourceEntityId, targetEntityId, relationType, validFromSceneId: null }, select: { id: true } });
    if (!exists) await prisma.relationship.create({ data: { projectId: currentProject.id, sourceEntityId, targetEntityId, relationType, source: 'author_manual', confidenceScore: 1 } });
  }

  for (const [index, event] of timeline.entries()) {
    const [key, title, date, temporalLabel, impact, arcKey, entityKeys] = event;
    const exists = await prisma.timelineEvent.findFirst({ where: { projectId: currentProject.id, title, deletedAt: null }, select: { id: true, description: true } });
    if (exists) {
      if (exists.description?.startsWith('Hecho narrativo:')) {
        await prisma.timelineEvent.update({
          where: { id: exists.id },
          data: { date, temporalLabel, ...(arcKey ? { storyboardArcId: arcIds.get(arcKey) } : { storyboardArcId: null }) },
        });
      }
      continue;
    }
    await prisma.timelineEvent.create({ data: { projectId: currentProject.id, title, description: `Hecho narrativo: ${title}.`, date, temporalLabel, impact, position: (index + 1) * 1000, source: 'author_manual', confidenceScore: 1, ...(arcKey ? { storyboardArcId: arcIds.get(arcKey) } : {}), ...(sceneIds.length ? { sourceSceneId: sceneIds[index % sceneIds.length] } : {}), entities: { create: entityKeys.map((entityKey) => ({ entityId: entityIds.get(entityKey) })) } } });
  }

  const cards = [['La señal obliga a Eliana a salir', 'llamado', 'ideas'], ['Investigar los archivos prohibidos', 'biblioteca', 'planned'], ['Descifrar la carta del norte', 'cartas', 'in-progress'], ['Resolver la alianza incómoda', 'archivo', 'completed']];
  for (const [index, card] of cards.entries()) {
    const [title, chapterKey, status] = card; const exists = await prisma.storyboardNote.findFirst({ where: { projectId: currentProject.id, title, deletedAt: null }, select: { id: true } });
    if (!exists) await prisma.storyboardNote.create({ data: { projectId: currentProject.id, chapterId: chapterByTitle.get(chapterTitles[chapterKey]), title, content: `Plan narrativo: ${title}.`, status, tags: ['demo', 'trama'], characters: ['Eliana', 'Adrián Rivas'], entityIds: [entityIds.get('eliana'), entityIds.get('adrian')], sortKey: String(900001 + index) } });
  }

  const matrix = [['semilla', 'llamado', 'La señal azul despierta la leyenda de la Semilla de Luz.'], ['archivo', 'biblioteca', 'La escalera lleva el misterio desde la casa hacia los documentos prohibidos.'], ['archivo', 'cartas', 'La carta rota revela que el norte conoce el peligro antes que Eliana.'], ['alianza', 'archivo', 'La revelación de los nombres tachados fuerza la colaboración.']];
  for (const [index, note] of matrix.entries()) {
    const [arcKey, chapterKey, content] = note; const arcId = arcIds.get(arcKey); const chapterId = chapterByTitle.get(chapterTitles[chapterKey]);
    const exists = await prisma.storyboardMatrixNote.findFirst({ where: { arcId, chapterId, content, deletedAt: null }, select: { id: true } });
    if (!exists) await prisma.storyboardMatrixNote.create({ data: { arcId, chapterId, content, sortKey: String(900001 + index) } });
  }

  const missingSummaryChapter = chapterByTitle.get(chapterTitles.biblioteca);
  const summary = await prisma.summary.findUnique({ where: { scopeType_scopeId: { scopeType: 'chapter', scopeId: missingSummaryChapter } }, select: { id: true } });
  if (!summary) await prisma.summary.create({ data: { projectId: currentProject.id, scopeType: 'chapter', scopeId: missingSummaryChapter, title: chapterTitles.biblioteca, content: 'Eliana y sus aliados descubren una escalera oculta bajo los archivos prohibidos y enfrentan a un guardián de piedra.', source: 'author_manual' } });

  console.log(`Datos demo coherentes cargados en “${currentProject.title}”.`);
  console.log('Wiki: 12 entidades; relaciones: 6; arcos: 3; timeline: 10; notas y resúmenes incluidos.');
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
