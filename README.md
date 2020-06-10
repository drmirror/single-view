# Single-View

This is an app that builds a single-view of data coming from several source systems. For example, if you have records of your customers in several different systems, A, B, and C, this app can find out which customers in each of these systems are likely to be the same person and will group them together. This works even if those customer records have slight differences, such as a typo in a name or birth date.

This is also known as Master Data Management (MDM).

The app runs on MongoDB's Realm platform, which means both the app and your data are in the cloud, and you don't need to host or operate any of that yourself. We call it "Single-View at the Push of a Button", the title of our talk at MongoDB.live 2020.

This documentation covers:

* How it works
* How to set it up
* How to use it

# How it works

This app takes documents that represent customers (or other entities), usually in a simple, flat format as they might come out of a legacy system:

    {
      "_id" : "A-001",
      "first_name" : "JAMES",
      "last_name" : "BOND",
      "dob" : "1968-07-28"
    }
   
    {
      "_id" : "B-005",
      "first_name" : "JIM",
      "last_name" : "BOND",
      "dob" : "1968-07-28"
    }
   
    {
      "_id" : "C-023",
      "first_name" : "JAMES",
      "last_name" : "BONDY",
      "dob" : "1968-07-28"
    }
   
These documents obviously all represent the same person, with minor variations in spelling. The app detects these matches and builds a master document from the sources which looks like this:

    {
       "_id" : ObjectId("5ee0e825a1477973589b525a"),
       "master" : {
         "first_name" : "JAMES",
         "last_name" : "BOND",
         "dob" : "1968-07-28"
       },
       "sources" : [
         {
            "_id" : "A-001",
            "first_name" : "JAMES",
            "last_name" : "BOND",
            "dob" : "1968-07-28"
         },
         {
            "_id" : "B-005",
            "first_name" : "JIM",
            "last_name" : "BOND",
            "dob" : "1968-07-28"
          },
          {
            "_id" : "C-023",
            "first_name" : "JAMES",
            "last_name" : "BONDY",
            "dob" : "1968-07-28"
          }       
       ]
    }

This format nicely groups the customers that belong together into one document. The sources section contains unaltered copies of exactly the data that came out of the source systems. The master section is the "truth" about that customer as we inferred it from the source records. In this case, two out of three sources agreed on either the first name or the last name, and that's how we were able to decide which is likely the correct name.

How the app gets there is pretty complex, but it's not necessary to understand the details, which we have described elsewhere. It uses a mechanism called single-linkage clustering, which performs repeated passes over all the documents, finds matches and groups them together. From a user perspective, all that is necessary to get it to work is to configure it for your specific documents and their attributes, which is described further below. Let's first discuss how to set up the app.

# How to set it up

There is nothing to install, as everything works serverless and in the cloud.

1. Get a cluster in MongoDB Atlas. For experiments, a free M0 cluster will do.
   
2. Create an empty Realm app linked to that cluster.

3. Import this app into the empty app in your cluster.

4. Take the sample data from this repo and import it into a collection named "source" in the database "single" in your cluster.

5. Run the "ingest" function, which imports the data from the "source" collection into a "master" collection in the same database "single".

6. Run the "sweep" function to find matches in the data and group them together.

    You can see the results in the "master" collection, but we also have a simple web UI that allows you to interact with that data.

# How to use it for your own data

The actual matching engine is implemented in the Ream function "single". All other functions eventually call this module. This is also where engine is configured, using a set of configuration variables at the beginning of the module. To adapt it to your own data, you will likely have to change the following variables:

* DISTANCE_FIELDS is a list of attributes from the source documents that determine how we calculate the distance between two documents. Each attribute is represented by a two-element array, where the first element is the name of the attribute, and the second is the weight of that attribute. All weights in that list should add up to one.

* DISTANCE_THRESHOLD is the maximum distance between two documents for us to consider them "the same person".

* TRUTH_FIELDS is a document where the keys are the attributes that we wish to carry from the source documents to the master document. For each attribute we specify a "selector", which is a function that finds the correct value among the set of values provided by the source systems. In most cases, you will want to use the function "selectMajority" here, which chooses the value that occurs most often among the source systems. 
