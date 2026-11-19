// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { clsWhat, clsWhere } from './vitals'

// The CLS attribution's two element labels (owner 2026-11-19, "shift fix yes"): reduced in the browser to closed labels —
// the element, its selector and its text never leave clsWhere / clsWhat.
const html = (s: string) => { document.body.innerHTML = s; return document.body }

describe('clsWhere — the largest shift element\'s nearest landmark', () => {
  it('names the landmark, from the most specific', () => {
    html('<header><nav><a id="a">x</a></nav></header><main><div role="dialog"><p id="d">y</p></div><img id="i"></main><aside><p id="s">z</p></aside><footer><p id="f">w</p></footer><div id="o">o</div>')
    expect(clsWhere(document.getElementById('a'))).toBe('header')
    expect(clsWhere(document.getElementById('d'))).toBe('dialog')
    expect(clsWhere(document.getElementById('i'))).toBe('main')
    expect(clsWhere(document.getElementById('s'))).toBe('aside')
    expect(clsWhere(document.getElementById('f'))).toBe('footer')
    expect(clsWhere(document.getElementById('o'))).toBe('other')
    html('<nav><span id="n">x</span></nav>')
    expect(clsWhere(document.getElementById('n'))).toBe('nav')
    // ⛔ A card's own <header>/<footer> is not the page's: it counts as the section it sits in.
    html('<main><article><header><img id="c"></header><footer><p id="cf">x</p></footer></article></main><section><footer><b id="sf">y</b></footer></section>')
    expect(clsWhere(document.getElementById('c'))).toBe('main')
    expect(clsWhere(document.getElementById('cf'))).toBe('main')
    expect(clsWhere(document.getElementById('sf'))).toBe('other')
    html('<div role="banner"><i id="rb">x</i></div>')
    expect(clsWhere(document.getElementById('rb'))).toBe('header')
  })
  it('a text node, a detached element or nothing', () => {
    html('<main><p id="p">hello</p></main>')
    expect(clsWhere(document.getElementById('p')!.firstChild)).toBe('main')
    expect(clsWhere(document.createElement('div'))).toBe('other')
    expect(clsWhere(null)).toBe('other')
    expect(clsWhere(undefined)).toBe('other')
  })
})

describe('clsWhat — what the element was', () => {
  it('a picture, a video, a frame, a line of text or a block', () => {
    html('<img id="i"><video id="v"></video><iframe id="f"></iframe><p id="t">Hello</p><div id="b"><p>x</p></div><div id="e"></div>')
    expect(clsWhat(document.getElementById('i'))).toBe('img')
    expect(clsWhat(document.getElementById('v'))).toBe('video')
    expect(clsWhat(document.getElementById('f'))).toBe('iframe')
    expect(clsWhat(document.getElementById('t'))).toBe('text')
    expect(clsWhat(document.getElementById('b'))).toBe('block')
    expect(clsWhat(document.getElementById('e'))).toBe('block')
    expect(clsWhat(null)).toBe('block')
    expect(clsWhat(document.getElementById('t')!.firstChild)).toBe('text')
  })
})
