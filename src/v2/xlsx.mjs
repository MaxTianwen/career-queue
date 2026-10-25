import { crc32, deflateRawSync } from 'node:zlib';

// Minimal .xlsx writer (no dependency): inline strings, a bold frozen header, filters and links.
const escape = value =>
  String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const column = index => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};
function sheetXml(sheet) {
  const links = [];
  const rows = [sheet.columns.map(c => c.header), ...sheet.rows].map((values, r) => {
    const cells = values.map((value, c) => {
      const ref = column(c) + (r + 1),
        style = r === 0 ? ' s="1"' : sheet.columns[c].link && value ? ' s="3"' : ' s="2"';
      if (r > 0 && sheet.columns[c].link && /^https:\/\//.test(value)) links.push({ ref, url: value });
      return value === '' || value === null || value === undefined
        ? `<c r="${ref}"${style}/>`
        : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
    });
    return `<row r="${r + 1}">${cells.join('')}</row>`;
  });
  const last = column(sheet.columns.length - 1) + Math.max(1, sheet.rows.length + 1);
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    (links.length
      ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>`
      : '') +
    '</worksheet>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    links
      .map(
        (l, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escape(l.url)}" TargetMode="External"/>`
      )
      .join('') +
    '</Relationships>';
  return { xml, rels: links.length ? rels : null };
}
function zip(files) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8'),
      packed = deflateRawSync(data),
      path = Buffer.from(name, 'utf8'),
      crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(path.length, 26);
    header.writeUInt16LE(0, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(path.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(header, path, packed);
    central.push(entry, path);
    offset += header.length + path.length + packed.length;
  }
  const size = central.reduce((sum, b) => sum + b.length, 0),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
// sheets: [{ name, columns: [{ header, width, link }], rows: [[string]] }]
export function workbook(sheets) {
  const files = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
          )
          .join('') +
        '</Types>'
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    ],
    [
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((s, i) => `<sheet name="${escape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets>' +
        `<definedNames>${sheets
          .map(
            (s, i) =>
              `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escape(s.name)}'!$A$1:$${column(s.columns.length - 1)}$${Math.max(1, s.rows.length + 1)}</definedName>`
          )
          .join('')}</definedNames></workbook>`
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    ],
    [
      'xl/styles.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
    ]
  ];
  sheets.forEach((sheet, i) => {
    const { xml, rels } = sheetXml(sheet);
    files.push([`xl/worksheets/sheet${i + 1}.xml`, xml]);
    if (rels) files.push([`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, rels]);
  });
  return zip(files);
}

const CHANNEL = { school: '学校', employer: '官网' };
// Application records as a spreadsheet: one row per job, plus the stage timeline.
export function applicationsWorkbook(rows) {
  const sorted = [...rows].sort((a, b) =>
    (b.tracking.appliedDate || '').localeCompare(a.tracking.appliedDate || '')
  );
  const records = sorted.map(row => {
    const t = row.tracking,
      f = t.facts;
    return [
      t.appliedDate,
      f.company,
      f.title,
      t.stageLabel,
      t.stageDate,
      row.submissions.map(s => `${CHANNEL[s.channel] || s.channel} ${s.date || '日期未知'}`).join('\n'),
      f.location,
      f.term,
      f.duration,
      f.salary,
      f.workMode,
      t.nextStep,
      t.due.replace('T', ' '),
      t.contact,
      t.notes,
      t.systemNotes.join('\n'),
      f.url
    ];
  });
  const events = sorted.flatMap(row =>
    row.tracking.events.map(event => [
      row.tracking.facts.company,
      row.tracking.facts.title,
      event.label,
      event.date,
      event.note,
      event.voided ? '已撤销：' + (event.voidReason || '') : ''
    ])
  );
  return workbook([
    {
      name: '申请记录',
      columns: [
        { header: '申请日期', width: 12 },
        { header: '公司', width: 22 },
        { header: '职位', width: 36 },
        { header: '进度', width: 10 },
        { header: '进度日期', width: 12 },
        { header: '渠道与提交日期', width: 20 },
        { header: '地点', width: 22 },
        { header: '学期', width: 16 },
        { header: '时长', width: 10 },
        { header: '薪资', width: 16 },
        { header: '办公方式', width: 10 },
        { header: '下一步', width: 28 },
        { header: '截止/时间', width: 16 },
        { header: '联系人/内推', width: 22 },
        { header: '备注', width: 36 },
        { header: '系统备注', width: 36 },
        { header: '官网链接', width: 40, link: true }
      ],
      rows: records
    },
    {
      name: '进展时间线',
      columns: [
        { header: '公司', width: 22 },
        { header: '职位', width: 36 },
        { header: '阶段', width: 10 },
        { header: '日期', width: 12 },
        { header: '说明', width: 40 },
        { header: '状态', width: 24 }
      ],
      rows: events
    }
  ]);
}
