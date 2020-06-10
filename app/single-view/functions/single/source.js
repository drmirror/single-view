// real test data config
const DB_NAME = "singlet";
const DISCRIMINATOR = "dob";
const DISTANCE_FIELDS = [ [ "first_name", 0.4 ], [ "last_name", 0.6 ] ];
const DISTANCE_THRESHOLD = 0.1;
const TRUTH_FIELDS = { "first_name" : { "selector" : selectMajority },
		       "middle_name" : { "selector" : selectMajority },
		       "last_name" : { "selector" : selectMajority },
		       "gender" : { "selector" : selectMajority },
		       "dob" : { "selector" : selectMajority },
		       "address" : { "selector" : selectDistinct },
		       "phone" : { "selector" : selectDistinct },
		       "email" : { "selector" : selectDistinct } };

// simple test data config
// const DB_NAME = "singlet";
// const DISCRIMINATOR = "discriminator";
// const DISTANCE_FIELDS = [ [ "data", 1 ] ];
// const DISTANCE_THRESHOLD = 0.001;
// const TRUTH_FIELDS = { "data" : { "selector" : selectAverage },
//                        "discriminator" : { "selector" : selectMajority } };


// other configuration params, shouldn't need to change thosew
const MASTER_NAME = "master";
const SOURCE_NAME = "source";
const WORK_NAME = "work";
const MATRIX_NAME = "matrix";

const DISTANCE = defaultDistance;
const TRUTHIFY = defaultTruthify;

const END_STAGE = "done";
const SWEEP_TIMEOUT = 80000;
const MATRIX_CHUNK_SIZE = 100000;

async function buildMockData(mdb, spec) {

    await mdb.master.deleteMany({});

    let id = 0;
    for (k in spec) {
        for (let i=0; i<spec[k]; i++) {
            idstr = ("00000000" + id).substr(-7);
            let data = Math.random();
            await mdb.master.insertOne(
                {
                    "master" : {
                        "discriminator" : k,
                        "data" : data
                    },
                    "sources" : [
                        {
                            "_id" : "S-" + idstr,
                            "discriminator" : k,
                            "data" : data
                        }
                    ]
                });
            id += 1;
        }
    }
    if (typeof context == "undefined")
        await mdb.master.createIndex({["master." + DISCRIMINATOR] : 1});

}

function rawLevenshtein (a, b) {

    // by Andrei Mackenzie, https://gist.github.com/andrei-m/982927
    // MIT License
    
    if(a.length == 0) return b.length;
    if(b.length == 0) return a.length;

    var matrix = [];

    // increment along the first column of each row
    var i;
    for(i = 0; i <= b.length; i++){
        matrix[i] = [i];
    }

    // increment each column in the first row
    var j;
    for(j = 0; j <= a.length; j++){
        matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for(i = 1; i <= b.length; i++){
        for(j = 1; j <= a.length; j++){
            if(b.charAt(i-1) == a.charAt(j-1)){
                matrix[i][j] = matrix[i-1][j-1];
            } else {
                matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, // substitution
                                        Math.min(matrix[i][j-1] + 1, // insertion
                                                 matrix[i-1][j] + 1)); // deletion
            }
        }
    }

    return matrix[b.length][a.length];
}

function normalizedLevenshtein (lhs, rhs) {
    if (lhs == null) lhs = "";
    if (rhs == null) rhs = "";
    var maxLength = Math.max (lhs.length, rhs.length);
    return rawLevenshtein(lhs,rhs) / maxLength;
}


function fieldDistance(a, b) {

    if (a == null && b == null)
        return 0;
    else if (a == null || b == null)
        return 1;
    else if (typeof a != typeof b)
        return 1;
    else if (typeof a == "string")
        return normalizedLevenshtein(a, b);
    else if (typeof a == "number")
        return Math.abs(a - b);
    else if (typeof a == "object")
        return documentDistance(a, b);
    else
        return 1;
    
}

/**
 * Returns the distance between two documents.
 * TODO: This assumes they have the same fields.
 */
function documentDistance(a, b) {

    let num = 0;
    let sum = 0;
    for (k in a) {
        if (!a.hasOwnProperty(k)) continue;
        sum += fieldDistance(a[k], b[k]);
        num += 1;
    }
    return sum / num;

}

function defaultDistance(a, b) {

    let masterA = a.hasOwnProperty("master") ? a["master"] : a;
    let masterB = b.hasOwnProperty("master") ? b["master"] : b;
    let sum = 0;
    let num = 0;
    if (Array.isArray(DISTANCE_FIELDS)) {
        DISTANCE_FIELDS.forEach(f => {
            let key = Array.isArray(f) ? f[0] : f;
            let weight = Array.isArray(f) ? f[1] : 1;
            if (key == DISCRIMINATOR) return;
            sum += weight * fieldDistance(masterA[key], masterB[key]);
            num += weight;
        });
    } else {
        for (let f in masterA) {
            if (f == DISCRIMINATOR || !masterA.hasOwnProperty(f)) continue;
            sum += fieldDistance(masterA[f], masterB[f]);
            num += 1;
        }
    }
    return sum / num;
}


function defaultTruthify(d) {

    if (TRUTH_FIELDS == null) {
        for (let k in d.sources[0]) {
            if (k == "_id") continue;
            d["master"][k] = selectMajority(d, k);
        }
    } else {
        for (k in TRUTH_FIELDS) {
            let truth = TRUTH_FIELDS[k];
            d["master"][k] = truth["selector"](d, k, truth["options"]);
        }
    }
    
}

/**
 * Selects the value that most of the source systems agree on,
 * optionally with different source systems having different weights
 * in the decision.
 */
function selectMajority(d, attribute, weights) {

    var scores = {};
    d.sources.forEach(s => {
        let weight = 1;
        if (weights != null) {
            let sourceSystem = s["_id"].match(/^([^-]+)/)[1];
            if (sourceSystem != null) {
                let newWeight = weights[sourceSystem];
                if (newWeight != null) weight = newWeight;
            }
        }
        if (!s.hasOwnProperty(attribute)) {
            return;
        } else {
            if (!scores.hasOwnProperty(s[attribute])) {
                scores[s[attribute]] = weight;
            } else {
                scores[s[attribute]] += weight;
            }
        }
    });

    var max_score = 0;
    var majority_value = undefined;

    for (var v in scores) {
        if (scores.hasOwnProperty(v)) {
            if (scores[v] > max_score) {
                max_score = scores[v];
                majority_value = v;
            }
        }
    }

    return majority_value;
}

function selectAverage(d, attribute, options) {

    let result = 0;
    d["sources"].forEach(s => { result += s[attribute] });
    return result / d["sources"].length;
    
}


/**
 * Selects all distinct values from all source systems
 * and returns them as a list.
 */
function selectDistinct(d, attribute, fuzz) {

    let result = [];
    let fuzzFactor = fuzz || 0;

    d["sources"].map(s => s[attribute]).forEach(v => {
        if (!containsValue(result, v, fuzzFactor)) result.push(v);
    });

    return result.length == 1 ? result[0] : result;
    
}

function containsValue (l, v, fuzz) {

    for (let i=0; i<l.length; i++) {
        if (fieldDistance(l[i], v) <= fuzz) return true;
    }
    return false;
    
}


// HELPER FUNCTIONS

/**
 * Gets a property NAME from a document D,
 * allowing dot notation for subdocuments.
 */
function getProperty(d, name) {
    if (typeof(name) == "string") {
        return getProperty(d, name.split("."));
    } else if (name.length == 1) {
        return d[name[0]];
    } else {
        return getProperty(d[name[0]], name.slice(1));
    }
}

/**
 * Returns the value from the array a that is closest to the document x
 * according to the standard distance function, if that distance is
 * less than DISTANCE_THRESHOLD, otherwise returns undefined.
 */
function closestWithinThreshold(a, x) {

    let minValue = 1;
    let minIndex = -1;
    for (let i=0; i<a.length; i++) {
        let d = DISTANCE(a[i], x);
        if (d < DISTANCE_THRESHOLD && d < minValue) {
            minValue = d;
            minIndex = i;
        }
    }
    return minIndex == -1 ? undefined : a[minIndex];
    
}


// FUNCTIONS SUPPORTING MAIN WORK FLOW =======================

function dehydrate(groups) {
    if (!groups
        || groups.length == 0
        || groups[0].length == 0
        || !(groups[0][0].hasOwnProperty("_id"))) {
        return groups;
    } else {
        return groups.map(g => g.map(d => d._id));
    }
}

async function hydrate(mdb, groups) {
    if (!groups
        || groups.length == 0
        || groups[0].length == 0
        || groups[0][0].hasOwnProperty("_id"))
        return groups;
    else {
        //let ids = [].concat.apply([], groups) // flatten
        let ids = [];
        groups.forEach(g => { g.forEach(i => {ids.push(i)})});
        let docs = await mdb.master.find({"_id" : { "$in" : ids }}).toArray();
        let dmap = {};
        docs.forEach(d => { dmap[d._id] = d });
        let result = groups.map(g => g.map(id => dmap[id]));
        return result;
    }
}


function minDistance(matrix) {
    let value = Infinity;
    let minI = -1;
    let minJ = -1;
    // TODO avoid repeated double-lookup by forEach and increment
    for (let i=1; i<matrix.length; i++) {
        for (let j=0; j<i; j++) {
            if (matrix[i][j] < value) {
                value = matrix[i][j];
                minI = i;
                minJ = j;
            }
        }
    }
    return { "value" : value, "i" : minI, "j" : minJ };
}

function lookupDistance(matrix, a, b) {
    if (a==b) return 0;
    if (a < b) return matrix[b][a];
    return matrix[a][b];
}

function clusterGroups(groups, matrix, a, b) {

    // combines two groups during the clustering phase
    
    // make sure a is less than b
    if (b < a) {
        let c = b;
        b = a;
        a = c;
    }
    // add the new group at the end of the group list
    groups.push(groups[a].concat(groups[b]));
    // compute distances to all existing groups
    let row = []
    for (let i=0; i<groups.length-1; i++) {
        let distA = lookupDistance(matrix, i, a);
        let distB = lookupDistance(matrix, i, b);
        row.push(Math.min(distA, distB));
    }
    row.push(0.0);
    matrix.push(row);
    // remove old groups, rows and columns
    groups.splice(b, 1);
    groups.splice(a, 1);
    matrix.splice(b, 1);
    matrix.splice(a, 1);
    for (let i=0; i<matrix.length; i++) {
        if (matrix[i].length > b) matrix[i].splice(b, 1);
        if (matrix[i].length > a) matrix[i].splice(a, 1);
    }
}

function mergeGroup(group) {
    if (group.length == 0) return null;

    let all_sources = {};
    group[0].sources.forEach(s => {
        all_sources[s._id] = 1;
    })

    let src = group[0].sources.slice();
    group.slice(1).forEach(m => {
        m.sources.forEach(s => {
            if (!all_sources.hasOwnProperty(s._id)) {
                src.push(s);
                all_sources[s._id] = 1;
            }
        })
    })

    let maxDistance = 0;
    for (i=0; i<group.length; i++) {
        for (j=0; j<i; j++) {
            dist = DISTANCE(group[i], group[j]);
            if (dist > maxDistance) {
                maxDistance = dist;
            }
        }
    }

    group[0].sources = src;
    TRUTHIFY(group[0])
    group[0].master.distance = maxDistance;
    return group[0];
}

// MAIN WORK FLOW =====================

async function getIncompleteWork(mdb) {

    let result = await mdb.work.find({"state":{"$ne":END_STAGE}})
        .sort({"ts":1}).limit(1).toArray();
    if (!result || result.length == 0)
        return null;
    else {
        let d = result[0];
        if (d.matrix && !Array.isArray(d.matrix)) {
            await loadMatrix(mdb, d);
        }
        if (d.groups) d.groups = await hydrate(mdb, d.groups);
	// in the realm driver, we get the matrix back immutable.
	// construct a mutable one from that.
        if (d.matrix) d.matrix = d.matrix.map(row => row.slice(0));
        return d;
    }

}

async function getNextWork(mdb) {

    let nextDiscriminator = null;
    let lastCompletedWork = await mdb.work.find({"state":END_STAGE})
        .sort({"discriminator":-1}).limit(1).toArray();
    let query = {};
    if (lastCompletedWork && lastCompletedWork.length == 1) {
        query["master." + DISCRIMINATOR] = { "$gt" : lastCompletedWork[0]["discriminator"] };
    }
    let nextDoc = await mdb.master.find(query)
        .sort({["master." + DISCRIMINATOR]:1}).limit(1).toArray();
    if (nextDoc == null || nextDoc.length == 0) {
        return null;
    } else {
        let result = {
            "discriminator" : nextDoc[0]["master"][DISCRIMINATOR],
            "state" : "loading",
            "ts" : new Date()
        };
        let status = await mdb.work.insertOne(result);
        console.log("inserted work: " + status.insertedId);
        result._id = status.insertedId;
        return result;
    }
    
}

async function getWork(mdb) {

    // get earliest work item that is not done
    let result = await getIncompleteWork(mdb);
    if (result == null) {
        result = await getNextWork(mdb);
    }
    return result;
    
}

async function doLoad(mdb, d) {

    console.log("loading " + d.discriminator);
    let items = await mdb.master.find({["master." + DISCRIMINATOR] : d.discriminator}).toArray();
    d.groups = items.map(item => [ item ]);
    d.matrix = [];
    d.i = 0;
    d.j = 0;
    d.state = "distancing";
    return "ok";
    
}

async function doDistance(mdb, d) {

    let numSteps = 0;
    let log = "distancing " + d.discriminator;
    if (d.i != 0 || d.j != 0) log += " (" + d.i + "," + d.j + ")";
    console.log(log);
    for (let i=d.i; i<d.groups.length; i++) {
        let row = [];
        if (d.matrix.length > i) {
            row = d.matrix[i];
        } else {
            d.matrix.push(row);
        }
        for (let j=row.length; j<=i; j++) {
            let dist = DISTANCE(d.groups[i][0], d.groups[j][0]);
            row.push(dist);
            d.i = i; d.j = j+1;
            numSteps += 1;
            if (numSteps % 1000 == 0 && isTimeout(mdb)) return "timeout";
        }
    }

    delete d.i;
    delete d.j;
    d.state = "clustering";
    return "ok";
    
}

async function doCluster(mdb, d) {

    console.log("clustering " + d.discriminator)
    while(true) {
        let min = minDistance(d.matrix);
        if (min.value > DISTANCE_THRESHOLD) break;
        clusterGroups(d.groups, d.matrix, min.i, min.j);
        if (isTimeout(mdb)) return "timeout";
    }

    delete d.matrix;
    d.currentGroup = 0;
    d.state = "merging";
    return "ok";
    
}

async function doMerge(mdb, d) {

    console.log("merging " + d.discriminator);
    for (let i=d.currentGroup; i<d.groups.length; i++) {
        let group = d.groups[i].filter(x => typeof x != "undefined");
        if (group.length > 1) {
            mergeGroup(group);
            let deletes = group.slice(1).map(x => x._id);
            await mdb.master.findOneAndReplace({"_id" : group[0]._id}, group[0]);
            await mdb.master.deleteMany({"_id" : { "$in" : deletes }});
	    d.groups[i] = [ group[0] ];
            d.currentGroup = i+1;
            if (isTimeout(mdb)) return "timeout";
        }
    }
    
    delete d.currentGroup;
    d.state = "done";
    return "ok";
}

async function saveWork(mdb, d) {

    let groups = null;
    let matrix = null;
    if (d.hasOwnProperty("groups")) {
        groups = d.groups;
        d.groups = dehydrate(groups);
    }
    d.ts = new Date();

    if (d.matrix) {
        let matrixSize = d.matrix.length * (d.matrix.length + 1) / 2;
        if (matrixSize > MATRIX_CHUNK_SIZE) {
            matrix = d.matrix;
            await saveMatrix(mdb, d);
        }
    } else {
        await mdb.matrix.deleteMany({"workUnit":d._id});
    }
    await mdb.work.replaceOne({"_id" : d._id}, d);

    if (groups != null) {
        d.groups = groups;
    }
    if (matrix != null) {
        d.matrix = matrix;
    }

}

async function saveMatrix(mdb, d) {

    let matrixId = (typeof context == "undefined") ? Math.random : new BSON.ObjectId();
    let chunkSeq = 0;
    let chunkStart = 0;
    let chunkSize = 0;
    let r = 0;
    while (true) {
        if (r >= d.matrix.length || chunkSize + d.matrix[r].length > MATRIX_CHUNK_SIZE) {
            await mdb.matrix.insertOne({
                "matrixId" : matrixId,
                "workUnit" : d._id,
                "seq" : chunkSeq,
                "chunk" : d.matrix.slice(chunkStart, r)
            });
            if (r >= d.matrix.length) break;
            chunkSeq += 1;
            chunkSize = 0;
            chunkStart = r;
        }
        chunkSize += d.matrix[r].length;
        r += 1;
    }
    d.matrix = matrixId;

}

async function loadMatrix(mdb, d) {

    let matrixId = d.matrix;
    let data = await mdb.matrix.find({"matrixId" : matrixId}).sort({"seq" : 1}).toArray();
    d.matrix = [];
    data.forEach(x => { x.chunk.forEach(row => { d.matrix.push(row) })});
    
}
    

function isTimeout(mdb) {
    return (new Date() - mdb.startTime) > SWEEP_TIMEOUT;
}

const nextStep = {
    "loading"    : doLoad,
    "distancing" : doDistance,
    "clustering" : doCluster,
    "merging"    : doMerge
};

async function sweep(mdb) {

    while(true) {

        let d = await getWork(mdb);
        if (d == null) return;

        while (true) {

            let result = await nextStep[d.state](mdb, d);
            await saveWork(mdb, d);
            if (result == "timeout") { console.log("timeout"); return; }
            if (d.state == END_STAGE) break;

        }

    }

}

async function addSource(mdb, s) {

    let x = undefined;
    if (s.hasOwnProperty("sources")) {
        x = s;
    } else {
        x = { "master" : {}, "sources" : [ s ] };
        TRUTHIFY(x);
    }

    let candidates = await mdb.master.find({
        ["master." + DISCRIMINATOR] : x["master"][DISCRIMINATOR]
    }).toArray();

    if (candidates.length > 1) {
        let bestMatch = closestWithinThreshold(candidates, x);
        if (bestMatch) {
            x = mergeGroup( [ bestMatch, x ] );
            return await mdb.master.replaceOne({"_id" : x._id}, x);
        }
    }
    return await mdb.master.insertOne(x);
    
}

async function ingest(mdb) {
    while (true) {
	let count = await mdb.source.count();
	if (count == 0) break;
	let ids = [];
	let buffer = [];
	let docs = await mdb.source.find({}).limit(1000).toArray();
	docs.forEach(d => {
	    ids.push(d._id);
	    let m = {
		"master" : { ...d },
		"sources" : [ { ...d } ]
	    };
	    delete m.master._id;
	    buffer.push(m);
	});
	if (isTimeout(mdb)) break;
	await mdb.master.insertMany(buffer);
	await mdb.source.deleteMany({"_id":{"$in":ids}});
    }
}

async function init() {
    let mdb = { "startTime" : new Date() };
    if (typeof context != "undefined") {
        mdb.db = context.services.get("single-atlas").db(DB_NAME);
    } else {
        mdb.client = new require("mongodb").MongoClient("mongodb://localhost:27017",
                                                        { "useNewUrlParser" : true } );
        await mdb.client.connect();
        mdb.db = await mdb.client.db(DB_NAME);
    }
    mdb.master = await mdb.db.collection(MASTER_NAME);
    mdb.source = await mdb.db.collection(SOURCE_NAME);
    mdb.work = await mdb.db.collection(WORK_NAME);
    mdb.matrix = await mdb.db.collection(MATRIX_NAME);
    return mdb;
}    

exports = async function (mode) {
    let mdb = await init();
    if (mode == "init") {

        await buildMockData(mdb, {
            "2000-01-01" : 500,
            "2000-01-02" : 500,
            "2000-01-03" : 500,
            "2000-01-04" : 500,
            "2000-01-05" : 500,
            "2000-01-06" : 500,
            "2000-01-07" : 500,
            "2000-01-08" : 500,
            "2000-01-09" : 500,
            "2000-01-10" : 500
        });
        console.log("built mock data");
        await mdb.work.deleteMany({});
        console.log("dropped work");
        await mdb.matrix.deleteMany({});
        console.log("dropped matrix");
        if (typeof context == "undefined")
            await mdb.matrix.createIndex({"matrixId":1, "seq":1});
        
    } else if (mode == "sweep") {
        await sweep(mdb);
    } else if (mode == "addSource") {
        await addSource(mdb, data);
    } else if (mode == "ingest") {
	await ingest(mdb);
    }
    if (mdb.client) {
        await mdb.client.close();
    }
}

//exports(process.argv[2]);
