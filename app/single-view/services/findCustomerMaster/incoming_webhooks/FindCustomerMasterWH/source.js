// This function is the webhook's request handler.
exports = async function(payload) {
    // Data can be extracted from the request as follows:

    var body = {};
    var result = {};
    if (payload.body) {
      console.log(JSON.stringify(payload.body));
      body = EJSON.parse(payload.body.text());
      console.log(JSON.stringify(body));
       
      console.log(JSON.stringify("Function findCustomer called ... executing..." ));
      var customer = context.services.get("single-atlas").db("single").collection("master");
      var result = await customer.findOne(body);
      console.log(JSON.stringify("return document" ));
      console.log(JSON.stringify(result));
    }
    
    return  result;
};