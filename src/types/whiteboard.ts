export type Tool = "select" | "pen" | "line" | "rect" | "ellipse" | "erase";


export type RemoteObject = {
id?: string;
json: string;  // was: object
createdAt?: any;
};


// If @types/fabric is installed, fabric.Object exists in the global ambient types a
export type WBObject = fabric.Object;