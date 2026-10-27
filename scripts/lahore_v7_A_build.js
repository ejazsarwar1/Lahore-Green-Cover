// =====================================================================
//  LAHORE GREEN COVER v7 - SCRIPT A: BUILD (run once, saves assets)
//
//  WHAT IS NEW
//   * Trees are estimated as a FRACTION of every 10 m pixel (0-100 %),
//     learned from the Meta/WRI 1 m canopy-height map (trees >= 3 m).
//     Street and garden trees inside mixed pixels are now counted.
//   * Grass / lawns / parks are learned from OpenStreetMap parks, lawns,
//     golf courses and green areas (your uploaded OSM asset).
//   * City-context features: built-up density within 500 m and distance
//     to the city centre (helps tell lawns and parks from crops).
//   * Spatial hold-out: one fold of the tree samples and 30 % of the OSM
//     polygons are never used for training, so Script B can test on them.
//
//  BEFORE YOU RUN
//   Upload osm_upload/lahore_osm_green.zip as a table asset named
//   'lahore_osm_green' in your project (Assets > NEW > Shape files).
//
//  HOW TO RUN
//   STEP = 1 -> Run -> Tasks: RUN 'lahore_v7_tree_samples' and
//               'lahore_v7_class_samples'. Wait until both finish.
//   STEP = 2 -> Run -> Tasks: RUN each 'lahore_v7_YYYY'.
//   Then open Script B (lahore_v7_B_app.js).
// =====================================================================
(function () {

// ---------------------------------------------------------------------
// 1. SETTINGS
// ---------------------------------------------------------------------
var ASSET_FOLDER = 'projects/lahore-green-cover-2000-2026/assets/';
var STEP = 1;
var YEARS_TO_BUILD = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
var TRAIN_YEAR = 2020;      // closest to the canopy map's imagery dates
var REF_YEAR = 2021;        // radiometric normalisation reference
var OSM_ASSET = ASSET_FOLDER + 'lahore_osm_green';
var CANOPY_ID = 'projects/meta-forest-monitoring-okw37/assets/CanopyHeight';
var CITY_CENTRE = [74.33, 31.55];
var SEASONS = [
  {d0: 32, d1: 90, tag: 's1'},     // 1 Feb - 31 Mar
  {d0: 130, d1: 171, tag: 's2'},   // 10 May - 20 Jun
  {d0: 274, d1: 298, tag: 's3'}    // 1 - 25 Oct
];
var CS_MIN = 0.6, AOT_MAX = 0.8;
var N_MEMBERS = 3;
var N_TREE_RANDOM = 5000, N_TREE_GREEN = 2000;   // tree-fraction training points
var BOUNDARY_ASSET = '';

// ---------------------------------------------------------------------
// 2. DATA
// ---------------------------------------------------------------------
var lahore = BOUNDARY_ASSET ? ee.FeatureCollection(BOUNDARY_ASSET) :
  ee.FeatureCollection('WM/geoLab/geoBoundaries/600/ADM2')
    .filter(ee.Filter.eq('shapeGroup', 'PAK'))
    .filter(ee.Filter.stringContains('shapeName', 'ahore'));
var geom = lahore.geometry();
var worldCover = ee.Image('ESA/WorldCover/v200/2021').select('Map');
var WC2020 = ee.Image('ESA/WorldCover/v100/2020').select('Map');
var notWater = worldCover.neq(80);
var PIF = worldCover.eq(50).focalMean(60, 'square', 'meters').gte(0.99);

var BANDS = ['B2', 'B3', 'B4', 'B8', 'B11', 'B12'];
var BANDS_N = BANDS.concat(['NDVI']);
var CSP = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
function s2col(y, d0, d1) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(geom)
    .filterDate(ee.Date.fromYMD(y, 1, 1), ee.Date.fromYMD(y + 1, 1, 1))
    .filter(ee.Filter.calendarRange(d0, d1, 'day_of_year'))
    .linkCollection(CSP, ['cs_cdf'])
    .map(function (img) {
      var ok = img.select('cs_cdf').gte(CS_MIN)
        .and(img.select('AOT').multiply(0.001).lte(AOT_MAX));
      var sr = img.select(BANDS).multiply(0.0001);
      return sr.addBands(sr.normalizedDifference(['B8', 'B4']).rename('NDVI'))
        .updateMask(ok).copyProperties(img, ['system:time_start']);
    });
}
var EMPTY = ee.Image.constant([0, 0, 0, 0, 0, 0, 0]).rename(BANDS_N).updateMask(0);
function safeMedian(col) {
  return ee.Image(ee.Algorithms.If(col.size().gt(0), col.median(), EMPTY));
}
function safeCount(col) {
  return ee.Image(ee.Algorithms.If(col.size().gt(0), col.select('NDVI').count(),
    ee.Image.constant(0))).rename('n');
}
var SM = {};
function seasonMedian(y, i) {
  var k = y + '_' + i;
  if (!SM[k]) SM[k] = safeMedian(s2col(y, SEASONS[i].d0, SEASONS[i].d1));
  return SM[k];
}
function normalize(img, ref) {
  var opts = {reducer: ee.Reducer.median(), geometry: geom, scale: 30, maxPixels: 1e10, tileScale: 4};
  var m = img.select(BANDS).updateMask(PIF).reduceRegion(opts);
  var r = ref.select(BANDS).updateMask(PIF).reduceRegion(opts);
  var ratios = BANDS.map(function (b) {
    return ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(m.get(b), null), 1,
      ee.Algorithms.If(ee.Algorithms.IsEqual(r.get(b), null), 1,
        ee.Number(r.get(b)).divide(m.get(b)))));
  });
  var n = img.select(BANDS).multiply(ee.Image.constant(ee.List(ratios))).rename(BANDS);
  return n.addBands(n.normalizedDifference(['B8', 'B4']).rename('NDVI'));
}
var DW_BANDS = ['water', 'trees', 'grass', 'flooded_vegetation', 'crops',
                'shrub_and_scrub', 'built', 'bare', 'snow_and_ice'];
var DW = {};
function dwMean(y) {
  if (!DW[y]) {
    DW[y] = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1').filterBounds(geom)
      .filterDate(ee.Date.fromYMD(y, 1, 1), ee.Date.fromYMD(y + 1, 1, 1))
      .select(DW_BANDS).mean();
  }
  return DW[y];
}
function pooledCol(y) {
  return s2col(y, SEASONS[0].d0, SEASONS[0].d1)
    .merge(s2col(y, SEASONS[1].d0, SEASONS[1].d1))
    .merge(s2col(y, SEASONS[2].d0, SEASONS[2].d1));
}

// Distance to the city centre (km) - fixed context feature.
var lonlat = ee.Image.pixelLonLat();
var dcore = lonlat.select('longitude').subtract(CITY_CENTRE[0]).multiply(94.9).pow(2)
  .add(lonlat.select('latitude').subtract(CITY_CENTRE[1]).multiply(110.6).pow(2)).sqrt().rename('dcore');

var FEATURE_NAMES = [];
SEASONS.forEach(function (s) { BANDS_N.forEach(function (b) { FEATURE_NAMES.push(b + '_' + s.tag); }); });
FEATURE_NAMES = FEATURE_NAMES.concat(['lasting', 'p10', 'p50', 'p90', 'ndmi', 'amp', 'bdens', 'dcore']);

var F = {};
function features(y) {
  if (F[y]) return F[y];
  var parts = SEASONS.map(function (s, i) {
    return normalize(seasonMedian(y, i), seasonMedian(REF_YEAR, i))
      .rename(BANDS_N.map(function (b) { return b + '_' + s.tag; }));
  });
  var nd = parts.map(function (p, i) { return p.select('NDVI_' + SEASONS[i].tag); });
  var lasting = nd[0].min(nd[1]).min(nd[2])
    .updateMask(nd[0].mask().and(nd[1].mask()).and(nd[2].mask())).rename('lasting');
  var amp = nd[0].max(nd[1]).max(nd[2]).subtract(lasting).rename('amp');   // seasonal swing
  var pooled = pooledCol(y);
  var pct = ee.Image(ee.Algorithms.If(pooled.size().gt(0),
    pooled.select('NDVI').reduce(ee.Reducer.percentile([10, 50, 90])),
    ee.Image.constant([0, 0, 0]).rename(['NDVI_p10', 'NDVI_p50', 'NDVI_p90']).updateMask(0)))
    .rename(['p10', 'p50', 'p90']);
  var ndmi = parts[1].normalizedDifference(['B8_s2', 'B11_s2']).rename('ndmi');
  // Built-up density within 500 m for THIS year (Dynamic World built probability).
  var bdens = dwMean(y).select('built').focalMean(500, 'circle', 'meters').rename('bdens');
  F[y] = ee.Image.cat(parts).addBands(ee.Image.cat([lasting, amp, pct, ndmi, bdens, dcore]))
    .select(FEATURE_NAMES).clip(geom);
  return F[y];
}

// ---------------------------------------------------------------------
// 3. STEP 1: training tables
// ---------------------------------------------------------------------
if (STEP === 1) {
  var fT = features(TRAIN_YEAR);

  // (a) Tree-fraction samples: features at 10 m + canopy fraction from 1 m heights.
  var chCol = ee.ImageCollection(CANOPY_ID);
  var tall = chCol.mosaic().select(0).setDefaultProjection(ee.Image(chCol.first()).projection()).gte(3);
  var greenish = WC2020.eq(10).or(worldCover.eq(10)).or(dwMean(TRAIN_YEAR).select('trees').gte(0.3));
  var pts = ee.FeatureCollection.randomPoints({region: geom, points: N_TREE_RANDOM, seed: 21})
    .merge(greenish.selfMask().clip(geom).sample({region: geom, scale: 10, numPixels: N_TREE_GREEN * 3,
      seed: 22, geometries: true, tileScale: 8}).limit(N_TREE_GREEN));
  var withF = fT.sampleRegions({collection: pts, scale: 10, geometries: true, tileScale: 8});
  var boxes = withF.map(function (f) {
    var c = f.geometry().coordinates();
    var fold = ee.Number(c.get(0)).multiply(20).floor().add(ee.Number(c.get(1)).multiply(20).floor()).mod(5);
    return f.setGeometry(f.geometry().buffer(5).bounds()).set('fold', fold);
  });
  var treeSamples = tall.reduceRegions({collection: boxes, reducer: ee.Reducer.mean(), scale: 1, tileScale: 4})
    .filter(ee.Filter.notNull(['mean']))
    .map(function (f) { return f.set('treefrac', f.get('mean')); });
  Export.table.toAsset({collection: treeSamples, description: 'lahore_v7_tree_samples',
    assetId: ASSET_FOLDER + 'lahore_v7_tree_samples'});

  // (b) Land-class samples: grass from OSM (70 % of polygons), the rest from
  //     WorldCover + Dynamic World agreement.
  var osm = ee.FeatureCollection(OSM_ASSET).randomColumn('r', 7);
  var osmGrassTrain = osm.filter(ee.Filter.inList('category', ['park', 'grass', 'golf', 'shrub']))
    .filter(ee.Filter.lt('r', 0.7));
  var osmAll = ee.Image().byte().paint(osm, 1).unmask(0);
  var osmGrassImg = ee.Image().byte().paint(osmGrassTrain, 1).unmask(0);
  var dw = dwMean(TRAIN_YEAR);
  var cls = ee.Image(0)
    .where(osmGrassImg.eq(1).and(dw.select('trees').lt(0.4)).and(fT.select('lasting').gte(0.2)), 1)
    .where(worldCover.eq(40).and(WC2020.eq(40)).and(dw.select('crops').gte(0.5)).and(osmAll.eq(0)), 3)
    .where(worldCover.eq(50).and(dw.select('built').gte(0.5)).and(osmAll.eq(0)), 4)
    .where(worldCover.eq(80).and(dw.select('water').gte(0.5)), 5)
    .where(worldCover.eq(60).and(dw.select('bare').gte(0.4)), 6)
    .rename('cls').selfMask().clip(geom);
  var classSamples = cls.addBands(fT).stratifiedSample({numPoints: 500, classBand: 'cls', region: geom,
    scale: 10, seed: 31, geometries: true, tileScale: 16, dropNulls: true,
    classValues: [1, 3, 4, 5, 6], classPoints: [1500, 1500, 1000, 300, 300]})
    .randomColumn('split', 5);
  Export.table.toAsset({collection: classSamples, description: 'lahore_v7_class_samples',
    assetId: ASSET_FOLDER + 'lahore_v7_class_samples'});
  print('STEP 1: RUN both tasks in the Tasks tab, wait for them to finish, then set STEP = 2.');
}

// ---------------------------------------------------------------------
// 4. STEP 2: predict every year and save one asset per year
// ---------------------------------------------------------------------
// Bands (Int16): tf (tree fraction x1000), tf0..tf2 (ensemble members),
//  grassp, cropp (probabilities x1000), lasting, rawlasting (NDVI x10000),
//  n1..n3 (clear looks per season), rule (v4 rule-based green 0/1),
//  dwarg (Dynamic World most likely class), dwtrees (x100),
//  red, green, blue (true colour x10000)
if (STEP === 2) {
  var treeTab = ee.FeatureCollection(ASSET_FOLDER + 'lahore_v7_tree_samples')
    .filter(ee.Filter.neq('fold', 0));                       // fold 0 kept for testing
  var classTab = ee.FeatureCollection(ASSET_FOLDER + 'lahore_v7_class_samples')
    .filter(ee.Filter.lt('split', 0.7))                      // 30 % kept for testing
    .map(function (f) {
      var c = ee.Number(f.get('cls'));
      return f.set('isGrass', c.eq(1)).set('isCrop', c.eq(3));
    });
  var treeModels = [];
  for (var k = 0; k < N_MEMBERS; k++) {
    treeModels.push(ee.Classifier.smileRandomForest({numberOfTrees: 100, seed: 40 + k, bagFraction: 0.7})
      .setOutputMode('REGRESSION')
      .train({features: treeTab.randomColumn('b', 50 + k).filter(ee.Filter.lt('b', 0.8)),
        classProperty: 'treefrac', inputProperties: FEATURE_NAMES}));
  }
  var grassModel = ee.Classifier.smileRandomForest({numberOfTrees: 150, seed: 61})
    .setOutputMode('PROBABILITY')
    .train({features: classTab, classProperty: 'isGrass', inputProperties: FEATURE_NAMES});
  var cropModel = ee.Classifier.smileRandomForest({numberOfTrees: 150, seed: 62})
    .setOutputMode('PROBABILITY')
    .train({features: classTab, classProperty: 'isCrop', inputProperties: FEATURE_NAMES});

  YEARS_TO_BUILD.forEach(function (y) {
    var f = features(y);
    var tfs = treeModels.map(function (m, i) {
      return f.classify(m).clamp(0, 1).multiply(1000).rename('tf' + i);
    });
    var tf = ee.Image.cat(tfs).reduce(ee.Reducer.mean()).rename('tf');
    var grassp = f.classify(grassModel).multiply(1000).rename('grassp');
    var cropp = f.classify(cropModel).multiply(1000).rename('cropp');
    var nd = [0, 1, 2].map(function (i) { return seasonMedian(y, i).select('NDVI'); });
    var rawLasting = nd[0].min(nd[1]).min(nd[2])
      .updateMask(nd[0].mask().and(nd[1].mask()).and(nd[2].mask()));
    var pooled = pooledCol(y);
    var pct = ee.Image(ee.Algorithms.If(pooled.size().gt(0),
      pooled.select('NDVI').reduce(ee.Reducer.percentile([10, 90])),
      ee.Image.constant([0, 0]).rename(['NDVI_p10', 'NDVI_p90']).updateMask(0)));
    var dw = dwMean(y);
    var rule = rawLasting.gte(0.30)
      .and(pct.select('NDVI_p10').gte(0.20))
      .and(pct.select('NDVI_p90').subtract(pct.select('NDVI_p10')).lte(0.40))
      .and(dw.select('trees').add(dw.select('grass')).add(dw.select('shrub_and_scrub')).gt(dw.select('crops')))
      .and(notWater);
    var counts = SEASONS.map(function (s, i) { return safeCount(s2col(y, s.d0, s.d1)).rename('n' + (i + 1)); });
    var rgb = ee.ImageCollection([seasonMedian(y, 0), seasonMedian(y, 1), seasonMedian(y, 2)])
      .median().select(['B4', 'B3', 'B2']).rename(['red', 'green', 'blue']);
    var out = ee.Image.cat([tf].concat(tfs).concat([grassp, cropp,
      f.select('lasting').multiply(10000).rename('lasting'),
      rawLasting.multiply(10000).rename('rawlasting')]).concat(counts).concat([
      rule.rename('rule'),
      dw.toArray().arrayArgmax().arrayGet(0).rename('dwarg'),
      dw.select('trees').multiply(100).rename('dwtrees'),
      rgb.multiply(10000)])).toInt16().clip(geom).set('year', y);
    Export.image.toAsset({image: out, description: 'lahore_v7_' + y,
      assetId: ASSET_FOLDER + 'lahore_v7_' + y, region: geom, scale: 10, maxPixels: 1e11,
      pyramidingPolicy: {'.default': 'mean', 'rule': 'mode', 'dwarg': 'mode'}});
  });
  print('STEP 2: ' + YEARS_TO_BUILD.length + ' tasks created. RUN each one in the Tasks tab.');
}

})();
