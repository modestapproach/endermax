// Parses layout.txt + image-settings.txt into a pure-data description of the
// store. Nothing here touches three.js, so the same model drives the 3D world,
// the heat field, the 2D plan map, and the results replay.
//
// Grid conventions (unchanged from v1 so recorded sessions stay comparable):
//   - layout rows    -> grid X (gx = startX + rowIndex)
//   - layout columns -> grid Z (gz = startZ + colIndex)
//   - height levels  -> grid Y (1..20), cell centers at gy * UNIT
//   - heat keys are "gx,gy,gz"

import layoutString from '../../layout.txt?raw';
import imageSettingsString from '../../image-settings.txt?raw';

export const UNIT = 0.5;
export const MAX_LEVEL = 21;

// Height bands per fixture type, in grid levels (inclusive).
const BANDS = {
    wall: [1, 10],
    sign: [13, 15],
    hanger: [13, 20],
    tall: [1, 4],
    shelfLevels: [1, 3, 5, 7, 10]
};

function parseImageSettings(text) {
    const settings = new Map();
    for (const line of text.split('\n')) {
        // Format: ID[WIDTH, TYPE, ATTRIBUTE, LABEL]
        const m = line.trim().match(/^(\w+)\[(\d+),\s*([^,]+),\s*([^,\]]+)(?:,\s*([^\]]+))?\]$/);
        if (!m) continue;
        settings.set(m[1], {
            width: parseInt(m[2], 10),
            type: m[3].trim(),
            attribute: m[4].trim(),
            label: m[5] ? m[5].trim() : undefined
        });
    }
    return settings;
}

function parseRows(text) {
    const rows = [];
    for (const line of text.split('\n')) {
        const m = line.match(/\[(.*?)\]/);
        if (m) rows.push(m[1]);
    }
    return rows;
}

export function parseLayout(layoutText = layoutString, settingsText = imageSettingsString) {
    const imageSettings = parseImageSettings(settingsText);
    const rows = parseRows(layoutText);
    const xSize = rows.length;
    const zSize = rows.length ? rows[0].length : 0;
    const startX = -Math.floor(xSize / 2);
    const startZ = -Math.floor(zSize / 2);

    const cells = new Map();          // "gx,gy,gz" -> cell metadata
    const columnPlan = new Set();     // "gx,gz" of plain wall columns
    const panels = [];                // product walls and hanging signs
    const hangers = [];
    const shelves = [];
    const talls = [];
    const items = [];
    const processed = new Set();

    const charAt = (r, c) => (rows[r] && rows[r][c]) || ' ';
    const addCells = (gx, gz, levels, meta) => {
        for (const gy of levels) cells.set(`${gx},${gy},${gz}`, { gx, gy, gz, ...meta });
    };
    const range = ([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

    for (let r = 0; r < xSize; r++) {
        for (let c = 0; c < zSize; c++) {
            if (processed.has(`${r},${c}`)) continue;
            const ch = charAt(r, c);
            const gx = startX + r;
            const gz = startZ + c;

            const s = imageSettings.get(ch);
            if (s) {
                if (s.type === '3D') {
                    items.push({ id: ch, gx, gz, label: s.label || 'Item' });
                    processed.add(`${r},${c}`);
                    continue;
                }

                let h = 1;
                while (charAt(r, c + h) === ch) h++;
                let v = 1;
                while (charAt(r + v, c) === ch) v++;

                const orientation = h === s.width ? 'horizontal' : v === s.width ? 'vertical' : null;
                if (orientation) {
                    const band = s.type === '#' ? BANDS.sign : BANDS.wall;
                    const kind = s.type === '#' ? 'sign' : 'wall';
                    const span = s.width;
                    const panel = {
                        id: ch, kind, label: s.label, orientation, span, band,
                        gx0: gx, gz0: gz,
                        gx1: orientation === 'vertical' ? gx + span - 1 : gx,
                        gz1: orientation === 'horizontal' ? gz + span - 1 : gz
                    };
                    panels.push(panel);
                    for (let i = 0; i < span; i++) {
                        const pr = orientation === 'vertical' ? r + i : r;
                        const pc = orientation === 'horizontal' ? c + i : c;
                        processed.add(`${pr},${pc}`);
                        addCells(startX + pr, startZ + pc, range(band), {
                            isImageBlock: true, imageNum: ch, label: s.label, blockType: s.type
                        });
                    }
                    if (orientation === 'horizontal') c += span - 1;
                    continue;
                }
                // Run length doesn't match the declared width: behaves as a wall column.
            }

            if (ch === 'x' || (s && s.type !== '3D')) {
                columnPlan.add(`${gx},${gz}`);
                addCells(gx, gz, range(BANDS.wall), { isImageBlock: false, blockType: 'x' });
            } else if (ch === 'e') {
                shelves.push({ gx, gz });
                addCells(gx, gz, BANDS.shelfLevels, { isImageBlock: false, blockType: 'e' });
            } else if (ch === '#') {
                // A bare '#' is a blank sign segment.
                panels.push({ id: '#', kind: 'sign', orientation: 'horizontal', span: 1, band: BANDS.sign, gx0: gx, gz0: gz, gx1: gx, gz1: gz });
                addCells(gx, gz, range(BANDS.sign), { isImageBlock: false, blockType: '#' });
            } else if (ch === '!') {
                hangers.push({ gx, gz });
                addCells(gx, gz, range(BANDS.hanger), { isImageBlock: false, blockType: '!' });
            } else if (ch === '&') {
                talls.push({ gx, gz });
                addCells(gx, gz, range(BANDS.tall), { isImageBlock: false, blockType: '&' });
            }
        }
    }

    return {
        unit: UNIT,
        origin: { gx: startX, gy: 0, gz: startZ },
        dims: { x: xSize, y: MAX_LEVEL + 1, z: zSize },
        cells, imageSettings,
        columns: greedyRects(columnPlan),
        panels, hangers, shelves, talls, items,
        bands: BANDS
    };
}

// Greedy rectangle cover of a set of "gx,gz" plan cells, so runs of wall
// columns become a handful of solid boxes instead of hundreds of cubes.
function greedyRects(plan) {
    const left = new Set(plan);
    const rects = [];
    const sorted = [...plan].map(k => k.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [gx, gz] of sorted) {
        if (!left.has(`${gx},${gz}`)) continue;
        let w = 1;
        while (left.has(`${gx},${gz + w}`)) w++;
        let d = 1;
        outer: while (true) {
            for (let i = 0; i < w; i++) if (!left.has(`${gx + d},${gz + i}`)) break outer;
            d++;
        }
        for (let a = 0; a < d; a++) for (let b = 0; b < w; b++) left.delete(`${gx + a},${gz + b}`);
        rects.push({ gx0: gx, gz0: gz, gx1: gx + d - 1, gz1: gz + w - 1 });
    }
    return rects;
}

// World-space helpers shared by every consumer.
export const cellCenter = (g) => g * UNIT;
export const cellKey = (gx, gy, gz) => `${gx},${gy},${gz}`;
export function worldToCell(x, y, z) {
    return { gx: Math.round(x / UNIT), gy: Math.round(y / UNIT), gz: Math.round(z / UNIT) };
}
