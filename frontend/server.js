import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||3020);
app.use(express.static(path.join(__dirname,"public")));
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("/user",(req,res)=>res.sendFile(path.join(__dirname,"public","user.html")));
app.listen(port,()=>console.log(`The Aura Funding UI listening on :${port}`));
