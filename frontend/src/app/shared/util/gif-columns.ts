/**
 * src/app/shared/util/gif-columns.ts
 * Spreads a list of GIFs over a number of columns, each GIF going to the column that is shortest so far (by the height its
 * picture will have). It replaces the CSS "columns" of the lists of GIFs: Safari (iPhone and iPad) redistributed the pictures
 * again every time more arrived and left the third column broken. Here the ones already placed never move: the result for
 * the first N GIFs is the same whatever comes after them.
 */
import type { GifResult } from '../../core/services/gif.service';

/** The GIFs in `count` columns, in reading order, filling the shortest column first. */
export function gifColumns(items: readonly GifResult[], count: number): GifResult[][] {
  const columns: GifResult[][] = [];
  const heights: number[] = [];
  for (let index = 0; index < count; index++) {
    columns.push([]);
    heights.push(0);
  }
  for (const item of items) {
    let shortest = 0;
    for (let index = 1; index < count; index++) {
      if (heights[index] < heights[shortest]) shortest = index;
    }
    columns[shortest].push(item);
    // The height of a picture of width 1: a picture without size counts as a square, so a broken one cannot unbalance the list.
    heights[shortest] += item.width > 0 && item.height > 0 ? item.height / item.width : 1;
  }
  return columns;
}
