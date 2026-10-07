# Column Block Types

This document defines the vertical block structure for different item types used in `image-settings.txt`.

## Type Definitions

### `x` (Standard Shelf/Wall)
- **Height**: 10 blocks
- **Vertical Range**: y=1 to y=10
- **Description**: Used for standard shelves and walls.
- **Pattern**: `11111111110000000000` (1=block, 0=empty, starting from y=1)

### `#` (Sign)
- **Height**: 3 blocks
- **Vertical Range**: y=13 to y=15
- **Description**: Used for hanging signs.
- **Pattern**: `00000000000011100000`

### `!` (Hanger/Post)
- **Height**: 8 blocks
- **Vertical Range**: y=13 to y=20
- **Description**: Used for vertical posts or hangers.
- **Pattern**: `00000000000011111111`

### `e` (Shelf Unit - Hardcoded)
- **Height**: Variable (5 blocks total)
- **Levels**: y=1, 3, 5, 7, 10
- **Description**: Open shelf unit structure.
- **Pattern**: `10101010010000000000`

### `&` (Tall Object)
- **Height**: 4 blocks
- **Vertical Range**: y=1 to y=4
- **Description**: Low obstacle or object.
- **Pattern**: `11110000000000000000`
