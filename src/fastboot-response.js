'use strict';

const FastBootHeaders = require('./fastboot-headers');

class FastbootResponse {

  constructor(response) {
    this._response = response;
    this.headers = new FastBootHeaders(response._headers);
  }

  get statusCode(){
    return this._response.statusCode || 200;
  }

  set statusCode(code){
    this._response.statusCode = code;
  }

  serialize(){
    return {
      headers: this.headers,
      statusCode: this.statusCode
    };
  }

  apply(subject){
    subject.statusCode = this.statusCode;
    subject.headers = this.headers;
  }

}

module.exports = FastbootResponse;
