(function () {
  const VERSION = 4;
  const SIZE = 17 + VERSION * 4;
  const DATA_CODEWORDS = 80;
  const ECC_CODEWORDS = 20;

  function makeTables() {
    const exp = new Array(512).fill(0);
    const log = new Array(256).fill(0);
    let value = 1;
    for (let i = 0; i < 255; i += 1) {
      exp[i] = value;
      log[value] = i;
      value <<= 1;
      if (value & 0x100) {
        value ^= 0x11d;
      }
    }
    for (let i = 255; i < 512; i += 1) {
      exp[i] = exp[i - 255];
    }
    return { exp, log };
  }

  const gf = makeTables();

  function gfMul(a, b) {
    if (a === 0 || b === 0) {
      return 0;
    }
    return gf.exp[gf.log[a] + gf.log[b]];
  }

  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i += 1) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j += 1) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], gf.exp[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsRemainder(data, degree) {
    const generator = rsGenerator(degree);
    const result = new Array(degree).fill(0);
    for (const byte of data) {
      const factor = byte ^ result.shift();
      result.push(0);
      for (let i = 0; i < degree; i += 1) {
        result[i] ^= gfMul(generator[i + 1], factor);
      }
    }
    return result;
  }

  function appendBits(bits, value, length) {
    for (let i = length - 1; i >= 0; i -= 1) {
      bits.push((value >>> i) & 1);
    }
  }

  function dataCodewords(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    if (bytes.length > 62) {
      throw new Error('QR Code excedeu a capacidade do modelo local.');
    }

    const bits = [];
    appendBits(bits, 0x4, 4);
    appendBits(bits, bytes.length, 8);
    bytes.forEach((byte) => appendBits(bits, byte, 8));
    appendBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
    while (bits.length % 8 !== 0) {
      bits.push(0);
    }

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) {
        byte = (byte << 1) | bits[i + j];
      }
      codewords.push(byte);
    }

    const pads = [0xec, 0x11];
    let index = 0;
    while (codewords.length < DATA_CODEWORDS) {
      codewords.push(pads[index % 2]);
      index += 1;
    }
    return codewords;
  }

  function blankMatrix() {
    return {
      modules: Array.from({ length: SIZE }, () => new Array(SIZE).fill(false)),
      reserved: Array.from({ length: SIZE }, () => new Array(SIZE).fill(false))
    };
  }

  function setModule(grid, x, y, dark, reserve = true) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
      return;
    }
    grid.modules[y][x] = Boolean(dark);
    if (reserve) {
      grid.reserved[y][x] = true;
    }
  }

  function finder(grid, left, top) {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const xx = left + x;
        const yy = top + y;
        if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE) {
          continue;
        }
        const separator = x === -1 || y === -1 || x === 7 || y === 7;
        const border = x === 0 || y === 0 || x === 6 || y === 6;
        const center = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        setModule(grid, xx, yy, !separator && (border || center));
      }
    }
  }

  function alignment(grid, cx, cy) {
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        const distance = Math.max(Math.abs(x), Math.abs(y));
        setModule(grid, cx + x, cy + y, distance === 2 || distance === 0);
      }
    }
  }

  function reserveFormat(grid) {
    const coords = [
      [8, 0],
      [8, 1],
      [8, 2],
      [8, 3],
      [8, 4],
      [8, 5],
      [8, 7],
      [8, 8],
      [7, 8],
      [5, 8],
      [4, 8],
      [3, 8],
      [2, 8],
      [1, 8],
      [0, 8]
    ];
    coords.forEach(([x, y]) => setModule(grid, x, y, false));
    for (let i = 0; i < 8; i += 1) {
      setModule(grid, 8, SIZE - 1 - i, false);
    }
    for (let i = 8; i < 15; i += 1) {
      setModule(grid, SIZE - 15 + i, 8, false);
    }
  }

  function drawFunctionPatterns(grid) {
    finder(grid, 0, 0);
    finder(grid, SIZE - 7, 0);
    finder(grid, 0, SIZE - 7);
    for (let i = 8; i < SIZE - 8; i += 1) {
      setModule(grid, i, 6, i % 2 === 0);
      setModule(grid, 6, i, i % 2 === 0);
    }
    alignment(grid, 26, 26);
    setModule(grid, 8, VERSION * 4 + 9, true);
    reserveFormat(grid);
  }

  function placeData(grid, codewords) {
    const bits = [];
    codewords.forEach((byte) => appendBits(bits, byte, 8));
    let bitIndex = 0;
    let upward = true;
    for (let right = SIZE - 1; right >= 1; right -= 2) {
      if (right === 6) {
        right -= 1;
      }
      for (let vertical = 0; vertical < SIZE; vertical += 1) {
        const y = upward ? SIZE - 1 - vertical : vertical;
        for (let x = right; x >= right - 1; x -= 1) {
          if (grid.reserved[y][x]) {
            continue;
          }
          const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
          setModule(grid, x, y, bit === 1, false);
          bitIndex += 1;
        }
      }
      upward = !upward;
    }
  }

  function maskCondition(x, y) {
    return (x + y) % 2 === 0;
  }

  function applyMask(grid) {
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (!grid.reserved[y][x] && maskCondition(x, y)) {
          grid.modules[y][x] = !grid.modules[y][x];
        }
      }
    }
  }

  function formatBits() {
    const errorCorrectionLevelL = 1;
    const mask = 0;
    const data = (errorCorrectionLevelL << 3) | mask;
    let bits = data << 10;
    for (let i = 14; i >= 10; i -= 1) {
      if ((bits >>> i) & 1) {
        bits ^= 0x537 << (i - 10);
      }
    }
    return ((data << 10) | bits) ^ 0x5412;
  }

  function drawFormat(grid) {
    const bits = formatBits();
    const coords = [
      [8, 0],
      [8, 1],
      [8, 2],
      [8, 3],
      [8, 4],
      [8, 5],
      [8, 7],
      [8, 8],
      [7, 8],
      [5, 8],
      [4, 8],
      [3, 8],
      [2, 8],
      [1, 8],
      [0, 8]
    ];
    coords.forEach(([x, y], index) => setModule(grid, x, y, ((bits >>> index) & 1) === 1));
    for (let i = 0; i < 8; i += 1) {
      setModule(grid, 8, SIZE - 1 - i, ((bits >>> i) & 1) === 1);
    }
    for (let i = 8; i < 15; i += 1) {
      setModule(grid, SIZE - 15 + i, 8, ((bits >>> i) & 1) === 1);
    }
  }

  function matrixFor(text) {
    const data = dataCodewords(text);
    const ecc = rsRemainder(data, ECC_CODEWORDS);
    const grid = blankMatrix();
    drawFunctionPatterns(grid);
    placeData(grid, data.concat(ecc));
    applyMask(grid);
    drawFormat(grid);
    return grid.modules;
  }

  function svgFor(text, options = {}) {
    const matrix = matrixFor(text);
    const quiet = 4;
    const total = SIZE + quiet * 2;
    const foreground = options.foreground || '#0b3f87';
    const background = options.background || '#ffffff';
    const paths = [];
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (matrix[y][x]) {
          paths.push(`M${x + quiet},${y + quiet}h1v1h-1z`);
        }
      }
    }
    return `<svg role="img" aria-label="QR Code NAVETRAN" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${background}"/><path d="${paths.join('')}" fill="${foreground}"/></svg>`;
  }

  function render(text, target, options = {}) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (!element) {
      return;
    }
    element.innerHTML = svgFor(text, options);
  }

  window.NavetranQr = { render, svgFor };
})();
