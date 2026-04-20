/**
 * FileOperator - Unified interface for file operations
 * Abstracts JSON and TMX file handling
 */

import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { query, updateAtPath, type QueryResult } from "./query";

/**
 * FileOperator interface
 */
export interface FileOperator {
  /**
   * Read file content and parse to structured data
   */
  read(content: string): unknown;

  /**
   * Serialize structured data to file content
   */
  write(data: unknown): string;

  /**
   * Query data using path pattern
   */
  query(data: unknown, path: string): QueryResult[];

  /**
   * Update value at path
   */
  update(data: unknown, path: string, newValue: unknown): unknown;
}

/**
 * JSON FileOperator
 */
export class JsonFileOperator implements FileOperator {
  read(content: string): unknown {
    return JSON.parse(content);
  }

  write(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }

  query(data: unknown, path: string): QueryResult[] {
    return query(data, path);
  }

  update(data: unknown, path: string, newValue: unknown): unknown {
    return updateAtPath(data, path, newValue);
  }
}

const xmlParserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
};

const xmlBuilderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  format: true,
};

/**
 * TMX FileOperator - handles XML-based TMX files
 */
export class TmxFileOperator implements FileOperator {
  private parser: XMLParser;
  private builder: XMLBuilder;

  constructor() {
    this.parser = new XMLParser(xmlParserOptions);
    this.builder = new XMLBuilder(xmlBuilderOptions);
  }

  read(content: string): unknown {
    return this.parser.parse(content);
  }

  write(data: unknown): string {
    return this.builder.build(data);
  }

  query(data: unknown, path: string): QueryResult[] {
    // TMX uses XPath-like queries via fast-xml-parser
    // For now, delegate to basic query
    return query(data, path);
  }

  update(data: unknown, path: string, newValue: unknown): unknown {
    return updateAtPath(data, path, newValue);
  }
}

/**
 * Get FileOperator instance by file type
 */
export function getFileOperator(fileType: "json" | "tmx"): FileOperator {
  switch (fileType) {
    case "json":
      return new JsonFileOperator();
    case "tmx":
      return new TmxFileOperator();
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}
