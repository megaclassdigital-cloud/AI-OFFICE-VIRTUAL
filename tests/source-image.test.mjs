import { describe, it, expect } from 'vitest';
import { isPublicHttpsUrl, extractImageUrls, extractTitle, pickSource } from '../scripts/source-image.mjs';

describe('isPublicHttpsUrl (penjaga SSRF)', () => {
  it('menerima https publik; menolak http, kredensial, localhost, IP privat/link-local/metadata', () => {
    expect(isPublicHttpsUrl('https://typesafe.ai/blog/jev-1-14')).toBe(true);
    for (const u of ['http://typesafe.ai/x', 'https://user:pw@typesafe.ai/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.2/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://intranet/x', 'file:///etc/passwd', 'javascript:alert(1)']) expect(isPublicHttpsUrl(u)).toBe(false);
  });
});

describe('extractImageUrls / extractTitle', () => {
  const html = `<html><head><title>  Jev 1.14 &amp; baru </title>
    <meta property="og:title" content="Jev 1.14 dirilis">
    <meta name="twitter:image" content="/img/tw.png">
    <meta content="https://cdn.typesafe.ai/og/jev.png" property="og:image">
    <meta property="og:image" content="http://insecure.example/x.png">
    <meta property="og:image" content="https://typesafe.ai/favicon.ico">
    <link rel="image_src" href="https://typesafe.ai/img/legacy.jpg"></head></html>`;
  it('urut prioritas og:image lebih dulu dari twitter dan image_src; relatif jadi absolut; menolak http, favicon, duplikat', () => {
    expect(extractImageUrls(html, 'https://typesafe.ai/blog/jev-1-14')).toEqual(['https://cdn.typesafe.ai/og/jev.png', 'https://typesafe.ai/img/tw.png', 'https://typesafe.ai/img/legacy.jpg']);
  });
  it('judul memakai og:title lebih dulu, lalu <title>', () => {
    expect(extractTitle(html)).toBe('Jev 1.14 dirilis');
    expect(extractTitle('<title> A &amp; B </title>')).toBe('A & B');
  });
});

describe('pickSource', () => {
  const research = { candidates: [{ id: 'c01', url: 'https://a.com/1', title: 'A' }, { id: 'c02', url: 'https://b.com/2', title: 'B', image_url: 'https://b.com/hero.jpg' }, { id: 'c03', url: 'http://insecure.com/3' }] };
  const verification = { results: [{ candidateId: 'c01', status: 'verified' }, { candidateId: 'c02', status: 'verified' }, { candidateId: 'c03', status: 'rejected' }] };
  const carousel = { slides: [{ index: 1, sourceRefs: ['c01', 'c02'] }, { index: 2, sourceRefs: ['c02'] }, { index: 3, sourceRefs: ['c03'] }, { index: 4, sourceRefs: [] }] };
  it('hanya slide dengan tepat satu sumber terverifikasi; memakai image_url dari Researcher bila ada', () => {
    expect(pickSource({ slideIndex: 1, carousel, research, verification })).toBeNull();      // rangkuman banyak sumber
    expect(pickSource({ slideIndex: 2, carousel, research, verification })).toMatchObject({ id: 'c02', imageUrl: 'https://b.com/hero.jpg' });
    expect(pickSource({ slideIndex: 3, carousel, research, verification })).toBeNull();      // tidak terverifikasi
    expect(pickSource({ slideIndex: 4, carousel, research, verification })).toBeNull();      // tanpa rujukan
    expect(pickSource({ slideIndex: 9, carousel, research, verification })).toBeNull();
  });
});
