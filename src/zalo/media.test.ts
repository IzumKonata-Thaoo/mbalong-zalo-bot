import {describe,expect,it} from "vitest";
import {extractZaloPhoto} from "./media.js";

describe("Zalo photo extraction",()=>{
  it("extracts the original photo and caption",()=>{
    expect(extractZaloPhoto({title:"@MbaLong giải bài này",href:"https://photo.zadn.vn/a.jpg",thumb:"https://photo.zadn.vn/t.jpg"})).toEqual({caption:"@MbaLong giải bài này",url:"https://photo.zadn.vn/a.jpg"});
  });
  it("reads photo metadata nested in params JSON",()=>{
    expect(extractZaloPhoto({params:JSON.stringify({oriUrl:"https://photo.zaloapp.com/a.png",caption:"xem ảnh"})})).toEqual({caption:"xem ảnh",url:"https://photo.zaloapp.com/a.png"});
  });
});
